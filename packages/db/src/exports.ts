import type { Proposal, PullRequest } from '@beacon/core';
import type { TransactionSql } from 'postgres';
export type ExportOutcome =
  | { status: 'pr_open'; branch: string; pr: PullRequest; proposalIds: string[] }
  | { status: 'apply_failed'; proposalIds: string[] };
export function loadApproved(
  _tx: TransactionSql,
  _runId: string,
): Promise<{ proposal: Proposal; engineRule: string; version: number }[]> {
  return Promise.reject(new Error('not implemented'));
}
export function recordExport(
  _tx: TransactionSql,
  _i: { orgId: string; runId: string; outcome: ExportOutcome; at: string },
): Promise<void> {
  return Promise.reject(new Error('not implemented'));
}
