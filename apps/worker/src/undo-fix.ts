import type { Clock, GitProvider } from '@beacon/core';
import type { Sql } from '@beacon/db';
export function undoFix(
  _d: { sql: Sql; git: GitProvider; clock: Clock },
  _i: { orgId: string; proposalId: string; userId: string },
): Promise<{ status: string }> {
  return Promise.reject(new Error('not implemented'));
}
