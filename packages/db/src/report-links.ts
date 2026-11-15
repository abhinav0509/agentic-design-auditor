// Share links for the URL-only report (FR-27, D-044). Callers of create and revoke pass a
// transaction that already runs as the app role with app.org_id set.
import { createHash } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { asApp } from './session.ts';

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createReportLink(
  tx: TransactionSql,
  {
    orgId,
    runId,
    token,
    expiresAt,
  }: { orgId: string; runId: string; token: string; expiresAt: Date },
): Promise<{ id: string }> {
  const [row] = await tx<{ id: string }[]>`
    insert into report_links (org_id, run_id, token_hash, expires_at)
    values (${orgId}, ${runId}, decode(${hashOf(token)}, 'hex'), ${expiresAt})
    returning id`;
  if (!row) throw new Error('report link not created');
  return row;
}

/** Revokes a link of the current org; a link of another org is not visible, so nothing changes. */
export async function revokeReportLink(
  tx: TransactionSql,
  { id, at }: { id: string; at: Date },
): Promise<void> {
  await tx`update report_links set revoked_at = ${at} where id = ${id} and revoked_at is null`;
}

/** The org and run a token opens at `at`, or null when it is unknown, expired or revoked. */
export async function resolveReportLink(
  sql: Sql,
  token: string,
  at: Date,
): Promise<{ orgId: string; runId: string } | null> {
  if (token === '') return null;
  const [row] = await asApp(sql, null, async (tx) => {
    await tx`select set_config('app.report_token_hash', ${hashOf(token)}, true)`;
    return tx<{ org_id: string; run_id: string }[]>`
      select org_id, run_id from report_links
      where revoked_at is null and expires_at > ${at}`;
  });
  return row ? { orgId: row.org_id, runId: row.run_id } : null;
}

export type ReportRows = {
  siteUrl: string;
  scannedAt: string;
  pages: { url: string; error: string | null }[];
  issues: {
    pageUrl: string;
    ruleId: string;
    actionable: boolean;
    impact: string;
    selector: string;
    html: string;
    help: string | null;
    tags: string[];
    crop: string | null;
  }[];
};

export function loadReportInput(_tx: TransactionSql, _runId: string): Promise<ReportRows> {
  return Promise.reject(new Error('not implemented'));
}

export function runHasCrop(_tx: TransactionSql, _runId: string, _ref: string): Promise<boolean> {
  return Promise.reject(new Error('not implemented'));
}
