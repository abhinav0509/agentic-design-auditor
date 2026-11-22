import type { AuditEvent } from '@beacon/core';
import type { TransactionSql } from 'postgres';
export function exportAuditLog(
  _tx: TransactionSql,
): Promise<{ orgId: string; events: AuditEvent[] }> {
  return Promise.reject(new Error('not implemented'));
}
