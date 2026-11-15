// The exporter (v1.0 §7.3, addendum 1.5, 2.6): approved proposals become one branch and one PR.
import type { GitProvider, Proposal, PullRequest } from '@beacon/core';
import { createHash } from 'node:crypto';

export type ExportDeps = {
  git: GitProvider;
  /** Verifies the combined result of the whole batch once (FR-25). */
  verify: (files: { path: string; content: string }[]) => Promise<{ ok: boolean }>;
};
export type ExportInput = { runId: string; proposals: Proposal[] };
export type ExportResult =
  | { status: 'pr_open'; branch: string; pr: PullRequest }
  | { status: 'apply_failed'; proposalIds: string[] }
  | { status: 'blocked'; proposalId: string; reasons: string[] }
  | { status: 'verification_failed' };

/** The changed lines of a one-hunk diff: at 0-based `line`, `remove` becomes `add`. */
type Replacement = { line: number; remove: string[]; add: string[] };

const linesOf = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * Checks a proposal's one-hunk diff against `source` (context and removed lines must match where
 * the hunk says) and returns only its changed lines, so neighbouring proposals' context never
 * conflicts. Returns null when the diff does not apply.
 */
function replacementOf(source: string, diff: string): Replacement | null {
  const rows: { t: string; text: string }[] = [];
  let start = -1;
  let hunks = 0;
  for (const raw of diff.split('\n').slice(0, -1)) {
    const header = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(raw);
    if (header) {
      hunks++;
      start = Number(header[1]);
    } else if (hunks === 0)
      continue; // the ---/+++ file lines
    else if (raw.startsWith('\\')) {
      const last = rows.at(-1);
      if (last) last.text = last.text.slice(0, -1);
    } else rows.push({ t: raw.charAt(0), text: `${raw.slice(1)}\n` });
  }
  if (hunks !== 1) return null;

  const old = rows.filter((r) => r.t !== '+').map((r) => r.text);
  const first = old.length === 0 ? start : start - 1; // "-N,0" means after line N
  const lines = linesOf(source);
  if (old.some((text, i) => lines[first + i] !== text)) return null;

  const pre = rows.findIndex((r) => r.t !== ' ');
  const changed = rows.slice(pre, rows.length - [...rows].reverse().findIndex((r) => r.t !== ' '));
  return {
    line: first + pre,
    remove: changed.filter((r) => r.t === '-').map((r) => r.text),
    add: changed.filter((r) => r.t === '+').map((r) => r.text),
  };
}

const branchName = (runId: string, ids: string[]) =>
  `beacon/${runId.slice(0, 8)}/${createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 12)}`;

const commitMessage = (p: Proposal) =>
  `${p.title}\n\n${p.rationale}\n\nBeacon-Proposal: ${p.proposal_id}\n`;

const prBody = (proposals: Proposal[]) =>
  [
    'Beacon proposed these changes and a reviewer approved each one.',
    '',
    ...proposals.map(
      (p) => `- **${p.title}** (\`${p.rule.id}\`, \`${p.target.file}\`): ${p.rationale}`,
    ),
    '',
    'Each commit carries a `Beacon-Proposal` trailer. Automated checks cannot find every barrier, so please test the pages with real users and assistive technology.',
  ].join('\n');

export async function exportBatch(deps: ExportDeps, input: ExportInput): Promise<ExportResult> {
  const { git } = deps;
  const proposals = [...input.proposals].sort((a, b) =>
    a.proposal_id < b.proposal_id ? -1 : a.proposal_id > b.proposal_id ? 1 : 0,
  );
  const base = await git.defaultBranch();
  const branch = branchName(
    input.runId,
    proposals.map((p) => p.proposal_id),
  );

  const head = await git.headSha(base);
  if (head === null) throw new Error(`default branch ${base} has no head`);
  let sha = head;
  for (const p of proposals) {
    const before = (await git.readFile(sha, p.target.file)) ?? '';
    const r = p.change && replacementOf(before, p.change.diff);
    if (!r) return { status: 'apply_failed', proposalIds: [p.proposal_id] };
    const lines = linesOf(before);
    lines.splice(r.line, r.remove.length, ...r.add);
    sha = await git.createCommit({
      parent: sha,
      path: p.target.file,
      content: lines.join(''),
      message: commitMessage(p),
    });
  }
  await git.createBranch(branch, sha);
  const pr = await git.openPullRequest({
    head: branch,
    base,
    title: `Beacon: ${String(proposals.length)} accessibility fix${proposals.length === 1 ? '' : 'es'}`,
    body: prBody(proposals),
  });
  return { status: 'pr_open', branch, pr };
}
