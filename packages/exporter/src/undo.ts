import type { GitProvider, Proposal, PullRequest } from '@beacon/core';
export type UndoResult =
  | { status: 'reverted_on_branch'; branch: string; commit: string }
  | { status: 'revert_pr_open'; branch: string; pr: PullRequest }
  | { status: 'no_longer_applies' };
export function undoProposal(
  _g: GitProvider,
  _i: { runId: string; proposal: Proposal; pr: { number: number; branch: string } },
): Promise<UndoResult> {
  return Promise.reject(new Error('not implemented'));
}
