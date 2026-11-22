import type { TransactionSql } from 'postgres';
export function agentPaused(_tx: TransactionSql): Promise<boolean> {
  return Promise.reject(new Error('not implemented'));
}
export function setAgentPaused(
  _tx: TransactionSql,
  _i: { paused: boolean; at: Date; reason?: string },
): Promise<void> {
  return Promise.reject(new Error('not implemented'));
}
