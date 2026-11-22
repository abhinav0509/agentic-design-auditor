import type { TransactionSql } from 'postgres';
export function registerSite(
  _tx: TransactionSql,
  _i: { orgId: string; baseUrl: string },
): Promise<string> {
  return Promise.reject(new Error('not implemented'));
}
export function issueOwnershipToken(
  _tx: TransactionSql,
  _i: { siteId: string; token: string },
): Promise<string> {
  return Promise.reject(new Error('not implemented'));
}
export function recordOwnershipProof(
  _tx: TransactionSql,
  _i: { siteId: string; at: Date },
): Promise<void> {
  return Promise.reject(new Error('not implemented'));
}
export function ownershipFresh(
  _tx: TransactionSql,
  _i: { siteId: string; now: Date },
): Promise<boolean> {
  return Promise.reject(new Error('not implemented'));
}
