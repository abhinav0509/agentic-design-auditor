// The exporter (v1.0 §7.3, addendum 1.5, 2.6): approved proposals become one branch and one PR.
import {
  DomainError,
  guard,
  type GitProvider,
  type GuardReason,
  type Proposal,
  type PullRequest,
} from '@beacon/core';
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
  | { status: 'blocked'; proposalId: string; reasons: GuardReason[] }
  | { status: 'verification_failed' };

/** The changed lines of a one-hunk diff: at 0-based `line`, `remove` becomes `add`. */
type Replacement = { line: number; remove: string[]; add: string[] };

export const linesOf = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * Checks a proposal's one-hunk diff against `source` (context and removed lines must match where
 * the hunk says) and returns only its changed lines, so neighbouring proposals' context never
 * conflicts. Returns null when the diff does not apply.
 */
export function replacementOf(
  source: string,
  diff: string,
  /** 'changed': check only the changed lines, not the context (undo, where neighbours moved on). */
  check: 'hunk' | 'changed' = 'hunk',
): Replacement | null {
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
  const pre = rows.findIndex((r) => r.t !== ' ');
  const changed = rows.slice(pre, rows.length - [...rows].reverse().findIndex((r) => r.t !== ' '));
  if (check === 'hunk' && old.some((text, i) => lines[first + i] !== text)) return null;
  if (
    check === 'changed' &&
    changed.filter((r) => r.t === '-').some((r, i) => lines[first + pre + i] !== r.text)
  )
    return null;
  return {
    line: first + pre,
    remove: changed.filter((r) => r.t === '-').map((r) => r.text),
    add: changed.filter((r) => r.t === '+').map((r) => r.text),
  };
}

export const branchName = (runId: string, ids: string[]) =>
  `beacon/${runId.slice(0, 8)}/${createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 12)}`;

// NFR-01 is enforced here, not by GitHub: contents:write cannot be limited to some branches.
export const ALLOWED_BRANCH = /^beacon\/[0-9a-f]{8}\/[0-9a-f]{12}$/;

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

const sha256 = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

type Step = { proposal: Proposal; path: string; content: string };

// Two changes conflict when their changed lines touch; an insertion occupies its own line.
const overlaps = (a: Replacement, b: Replacement) =>
  a.line < b.line + Math.max(b.remove.length, 1) && b.line < a.line + Math.max(a.remove.length, 1);

/**
 * Applies the proposals in order to the files at `head`: each diff is checked against the file as
 * it is at `head`, then its changed lines are spliced in, shifted by the earlier changes above it.
 */
async function planBatch(
  git: GitProvider,
  head: string,
  proposals: Proposal[],
): Promise<
  | { steps: Step[]; files: Map<string, string[]>; failed: string[] }
  | Extract<ExportResult, { status: 'blocked' }>
> {
  const originals = new Map<string, string | null>();
  const files = new Map<string, string[]>();
  const applied = new Map<string, Replacement[]>();
  const steps: Step[] = [];
  const failed: string[] = [];
  for (const p of proposals) {
    const path = p.target.file;
    if (!originals.has(path)) originals.set(path, await git.readFile(head, path));
    const original = originals.get(path) ?? null;
    const done = applied.get(path) ?? [];
    const r = original !== null && p.change ? replacementOf(original, p.change.diff) : null;
    if (original === null || !r || done.some((o) => overlaps(o, r))) {
      failed.push(p.proposal_id);
      continue;
    }
    const shift = done
      .filter((o) => o.line < r.line)
      .reduce((n, o) => n + o.add.length - o.remove.length, 0);
    const lines = files.get(path) ?? linesOf(original);
    const before = lines.join('');
    lines.splice(r.line + shift, r.remove.length, ...r.add);
    // Each step is guarded on top of the earlier ones, so the combined file is checked too (FR-25).
    const checked = guard({
      ruleId: p.rule.id,
      baseHash: sha256(before),
      files: [{ path, before, after: lines.join('') }],
    });
    if (!checked.ok)
      return { status: 'blocked', proposalId: p.proposal_id, reasons: checked.reasons };
    files.set(path, lines);
    applied.set(path, [...done, r]);
    steps.push({ proposal: p, path, content: lines.join('') });
  }
  return { steps, files, failed };
}

/** Plans, verifies and commits the batch on the default branch's head; returns the last commit. */
async function commitBatch(
  deps: ExportDeps,
  base: string,
  proposals: Proposal[],
): Promise<string | ExportResult> {
  const head = await deps.git.headSha(base);
  if (head === null) throw new Error(`default branch ${base} has no head`);
  const plan = await planBatch(deps.git, head, proposals);
  if ('status' in plan) return plan;
  const { steps, files, failed } = plan;
  if (failed.length > 0) return { status: 'apply_failed', proposalIds: failed };

  const combined = [...files]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, lines]) => ({ path, content: lines.join('') }));
  if (!(await deps.verify(combined)).ok) return { status: 'verification_failed' };

  let sha = head;
  for (const { proposal, path, content } of steps) {
    sha = await deps.git.createCommit({
      parent: sha,
      path,
      content,
      message: commitMessage(proposal),
    });
  }
  return sha;
}

export async function exportBatch(deps: ExportDeps, input: ExportInput): Promise<ExportResult> {
  const { git } = deps;
  const proposals = [...input.proposals].sort((a, b) =>
    a.proposal_id < b.proposal_id ? -1 : a.proposal_id > b.proposal_id ? 1 : 0,
  );
  const branch = branchName(
    input.runId,
    proposals.map((p) => p.proposal_id),
  );
  const base = await git.defaultBranch(); // live on every call, never cached (addendum 2.6)
  if (!ALLOWED_BRANCH.test(branch) || branch === base) {
    throw new DomainError('BRANCH_NOT_ALLOWED', `refusing to write ${branch}`);
  }

  // The branch is created last, pointing at the finished commits, so it exists only when complete
  // and a retry after any crash just opens the PR (NFR-03).
  if ((await git.headSha(branch)) === null) {
    const built = await commitBatch(deps, base, proposals);
    if (typeof built !== 'string') return built;
    await git.createBranch(branch, built);
  }
  const existing = await git.findPullRequest(branch);
  if (existing) return { status: 'pr_open', branch, pr: existing };
  const pr = await git.openPullRequest({
    head: branch,
    base,
    title: `Beacon: ${String(proposals.length)} accessibility fix${proposals.length === 1 ? '' : 'es'}`,
    body: prBody(proposals),
  });
  return { status: 'pr_open', branch, pr };
}
