// Undo (FR-15, addendum 1.5, D-058). Before merge, a revert commit on the fix's beacon/* branch drops
// it from the open PR (a fast-forward: the branch only moves on). After merge, a revert PR from the
// default branch undoes that fix only. The reverse change is the fix's own diff turned around and
// applied checking only the fix's own lines (neighbouring fixes may have changed the context), so
// a fix that is no longer there as made gives no_longer_applies.
import { DomainError, type GitProvider, type Proposal, type PullRequest } from '@beacon/core';
import { ALLOWED_BRANCH, branchName, linesOf, replacementOf } from './export.ts';

export type UndoResult =
  | { status: 'reverted_on_branch'; branch: string; commit: string }
  | { status: 'revert_pr_open'; branch: string; pr: PullRequest }
  | { status: 'no_longer_applies' };

/** The diff that undoes `diff`: removed and added lines swapped, and the hunk header with them. */
function reverse(diff: string): string {
  return diff
    .split('\n')
    .map((l) => {
      const h = /^@@ -(\S+) \+(\S+) @@(.*)$/.exec(l);
      if (h) return `@@ -${h[2] ?? ''} +${h[1] ?? ''} @@${h[3] ?? ''}`;
      if (l.startsWith('---') || l.startsWith('+++')) return l;
      if (l.startsWith('-')) return `+${l.slice(1)}`;
      if (l.startsWith('+')) return `-${l.slice(1)}`;
      return l;
    })
    .join('\n');
}

/** The file at `sha` with the fix taken out, or null when the fix is no longer there as made. */
async function without(git: GitProvider, sha: string, p: Proposal): Promise<string | null> {
  const source = await git.readFile(sha, p.target.file);
  const r =
    source === null || !p.change ? null : replacementOf(source, reverse(p.change.diff), 'changed');
  if (source === null || !r) return null;
  const lines = linesOf(source);
  lines.splice(r.line, r.remove.length, ...r.add);
  return lines.join('');
}

const refuse = (branch: string, base: string) => {
  if (!ALLOWED_BRANCH.test(branch) || branch === base)
    throw new DomainError('BRANCH_NOT_ALLOWED', `refusing to write ${branch}`);
};

export async function undoProposal(
  git: GitProvider,
  {
    runId,
    proposal: p,
    pr,
  }: { runId: string; proposal: Proposal; pr: { number: number; branch: string } },
): Promise<UndoResult> {
  const base = await git.defaultBranch(); // live on every call (addendum 2.6)
  const message = `Revert: ${p.title}\n\nUndoes this fix at a reviewer's request.\n\nBeacon-Revert: ${p.proposal_id}\n`;

  if (!(await git.pullRequestMerged(pr.number))) {
    refuse(pr.branch, base);
    const head = await git.headSha(pr.branch);
    if (head === null) return { status: 'no_longer_applies' };
    const content = await without(git, head, p);
    if (content === null) return { status: 'no_longer_applies' };
    const commit = await git.createCommit({ parent: head, path: p.target.file, content, message });
    await git.updateBranch(pr.branch, commit, head);
    return { status: 'reverted_on_branch', branch: pr.branch, commit };
  }

  const branch = branchName(runId, [`revert:${p.proposal_id}`]);
  refuse(branch, base);
  if ((await git.headSha(branch)) === null) {
    const head = await git.headSha(base);
    if (head === null) throw new Error(`default branch ${base} has no head`);
    const content = await without(git, head, p);
    if (content === null) return { status: 'no_longer_applies' };
    const commit = await git.createCommit({ parent: head, path: p.target.file, content, message });
    await git.createBranch(branch, commit);
  }
  const existing = await git.findPullRequest(branch);
  const opened =
    existing ??
    (await git.openPullRequest({
      head: branch,
      base,
      title: `Revert: ${p.title}`,
      body: `This undoes one Beacon fix from pull request #${String(pr.number)} at a reviewer's request.\n\nThe commit carries a \`Beacon-Revert\` trailer naming the fix.`,
    }));
  return { status: 'revert_pr_open', branch, pr: opened };
}
