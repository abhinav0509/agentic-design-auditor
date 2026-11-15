// The exporter (v1.0 §7.3, addendum 1.5, 2.6): approved proposals become one branch and one PR.
import type { GitProvider, Proposal, PullRequest } from '@beacon/core';

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

export function exportBatch(_deps: ExportDeps, _input: ExportInput): Promise<ExportResult> {
  return Promise.reject(new Error('not implemented'));
}
