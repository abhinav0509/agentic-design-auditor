// The app-role session every tenant query runs in (D-019): beacon_app, with app.org_id set for the
// transaction, so RLS applies.
import type { Sql, TransactionSql } from 'postgres';

export type { Sql, TransactionSql };

/** Runs fn in a transaction as beacon_app with app.org_id set (or unset when org is null). */
export function asApp<T>(
  sql: Sql,
  org: string | null,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe('set local role beacon_app');
    if (org) await tx.unsafe(`select set_config('app.org_id', $1, true)`, [org]);
    return fn(tx);
  }) as Promise<T>;
}
