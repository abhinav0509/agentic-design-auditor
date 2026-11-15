import type { Sql, TransactionSql } from 'postgres';

export function createReportLink(
  _tx: TransactionSql,
  _input: { orgId: string; runId: string; token: string; expiresAt: Date },
): Promise<{ id: string }> {
  return Promise.reject(new Error('not implemented'));
}
export function revokeReportLink(
  _tx: TransactionSql,
  _input: { id: string; at: Date },
): Promise<void> {
  return Promise.reject(new Error('not implemented'));
}
export function resolveReportLink(
  _sql: Sql,
  _token: string,
  _at: Date,
): Promise<{ orgId: string; runId: string } | null> {
  return Promise.reject(new Error('not implemented'));
}
