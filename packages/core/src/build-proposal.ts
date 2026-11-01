// The proposal builder (v1.0 §7.2, §8.1, D-032): turns the fixer's answer and the verifier's outcome
// into a schema-valid proposal and its initial status. Guard-blocked and failed fixer runs, and
// findings that do not reproduce locally, are not proposals: they stay in the trace or the report.
import type { EditOp } from './edit-ops.ts';
import { changedLines } from './guard.ts';
import type { Clock, IdGen } from './ports.ts';
import { parseProposal, type Proposal } from './proposal.ts';
import { classifyRisk, type RiskContext } from './risk.ts';
import { initialStatus, type Status } from './state-machine.ts';

/** The verifier's outcome for a patch it could reproduce (a subset of @beacon/verifier's result). */
export type VerificationOutcome = {
  status: 'passed' | 'failed';
  violationResolved: boolean;
  newViolations: number;
  visualDiffRatio: number;
};

type Common = { title: string; rationale: string; confidence: number };
export type BuildInput = {
  runId: string;
  agent: { name: string; version: string };
  finding: { ruleId: string; impact: string; selector: string; pageUrl: string };
  file: { path: string; source: string; baseHash: string; commitSha: string };
  context: RiskContext;
  result:
    | (Common & { kind: 'patch'; ops: EditOp[]; after: string; verification: VerificationOutcome })
    | (Common & { kind: 'needs_input'; question: { text: string; options: string[] } })
    | (Common & { kind: 'decline' });
};

const STANDARD_REFS: Record<string, string[]> = {
  'image-alt': ['WCAG 1.1.1'],
  label: ['WCAG 1.3.1', 'WCAG 4.1.2'],
  'html-has-lang': ['WCAG 3.1.1'],
};
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const CONTEXT_LINES = 3;

const linesOf = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * One-hunk unified diff around the changed lines; lines between two edits show as removed and
 * re-added, which git applies the same way.
 * shortcut: one hunk only; fine while the guard keeps patches small, split hunks if that changes.
 */
function unifiedDiff(path: string, before: string, after: string) {
  const a = linesOf(before);
  const b = linesOf(after);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  )
    suf++;
  const removed = a.length - suf - pre;
  const added = b.length - suf - pre;
  if (removed === 0 && added === 0) throw new Error('the patch changes nothing');

  const start = Math.max(0, pre - CONTEXT_LINES);
  const endA = Math.min(a.length, a.length - suf + CONTEXT_LINES);
  const endB = Math.min(b.length, b.length - suf + CONTEXT_LINES);
  const line = (prefix: string, text: string) =>
    `${prefix}${text}${text.endsWith('\n') ? '' : '\n\\ No newline at end of file\n'}`;
  const header = (len: number) => `${String(len === 0 ? start : start + 1)},${String(len)}`;
  const diff = [
    `--- a/${path}\n+++ b/${path}\n@@ -${header(endA - start)} +${header(endB - start)} @@\n`,
    ...a.slice(start, pre).map((l) => line(' ', l)),
    ...a.slice(pre, a.length - suf).map((l) => line('-', l)),
    ...b.slice(pre, b.length - suf).map((l) => line('+', l)),
    ...a.slice(a.length - suf, endA).map((l) => line(' ', l)),
  ].join('');
  return {
    diff,
    stats: { files: 1, added, removed },
    range: { start_line: pre + 1, end_line: Math.max(pre + 1, pre + removed) },
  };
}

export function buildProposal(
  input: BuildInput,
  deps: { clock: Clock; ids: IdGen },
): { proposal: Proposal; status: Status } {
  const { result: r, finding, file } = input;
  const now = deps.clock.now();
  const patch = r.kind === 'patch' ? unifiedDiff(file.path, file.source, r.after) : null;
  const proposal = parseProposal({
    schema_version: '1.0',
    proposal_id: deps.ids.uuid(),
    run_id: input.runId,
    agent: input.agent,
    kind: r.kind,
    title: r.title,
    rationale: r.rationale,
    rule: {
      id: finding.ruleId,
      standard_refs: STANDARD_REFS[finding.ruleId] ?? [],
      impact: finding.impact,
    },
    target: {
      page_url: finding.pageUrl,
      selector: finding.selector,
      file: file.path,
      range: patch?.range ?? { start_line: 1, end_line: 1 },
    },
    change: patch && { format: 'unified_diff', diff: patch.diff, stats: patch.stats },
    risk:
      r.kind === 'patch'
        ? {
            ...classifyRisk({
              ruleId: finding.ruleId,
              ops: r.ops,
              changedLines: changedLines(file.source, r.after),
              context: { ...input.context, visualDiffRatio: r.verification.visualDiffRatio },
              confidence: r.confidence,
            }),
            reversible: true,
          }
        : null,
    confidence: r.confidence,
    evidence: {
      // shortcut: screenshots are stored once a BlobStore exists; null until then.
      before_screenshot: null,
      after_screenshot: null,
      agent_trace_id: deps.ids.uuid(),
    },
    base: { commit_sha: file.commitSha, content_hash: file.baseHash },
    verification:
      r.kind === 'patch'
        ? {
            violation_resolved: r.verification.violationResolved,
            new_violations: r.verification.newViolations,
            visual_diff_ratio: r.verification.visualDiffRatio,
          }
        : null,
    question: r.kind === 'needs_input' ? r.question : null,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + LIFETIME_MS).toISOString(),
  });
  // A failed verification (over the visual cap too) is never pending, whatever the counts say.
  const status =
    r.kind === 'patch' && r.verification.status === 'failed'
      ? 'failed_verification'
      : initialStatus(proposal, { guardPassed: true });
  return { proposal, status };
}
