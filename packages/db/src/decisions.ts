import type { DecisionInput, DecisionResult } from '@beacon/core';
import type { Sql, TransactionSql } from 'postgres';
export function ensureOperator(_sql: Sql, _i: { orgId: string; email: string }): Promise<string> {
  return Promise.reject(new Error('not implemented'));
}
export function decideProposal(
  _tx: TransactionSql,
  _i: { orgId: string; proposalId: string; userId: string; input: DecisionInput; at: string },
): Promise<DecisionResult> {
  return Promise.reject(new Error('not implemented'));
}
