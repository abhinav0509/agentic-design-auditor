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

/** A run as the report reads it, under the caller's org (asApp with the link's org). */
export async function loadReportInput(tx: TransactionSql, runId: string): Promise<ReportRows> {
  const [run] = await tx<{ base_url: string; scanned_at: Date }[]>`
    select s.base_url, coalesce(r.started_at, r.created_at) as scanned_at
    from scan_runs r join sites s on s.id = r.site_id where r.id = ${runId}`;
  if (!run) throw new Error(`no run ${runId}`);
  const pages = await tx<{ url: string; error: string | null }[]>`
    select url, scan_error as error from pages where run_id = ${runId} order by url`;
  const issues = await tx<ReportRows['issues']>`
    select p.url as "pageUrl", f.rule_id as "ruleId", f.actionable, f.impact, f.selector,
      f.html_snippet as html, f.help, f.tags, f.evidence->>'crop' as crop
    from findings f join pages p on p.id = f.page_id
    where f.run_id = ${runId} order by p.url, f.selector, f.rule_id`;
  return {
    siteUrl: run.base_url,
    scannedAt: run.scanned_at.toISOString(),
    pages: [...pages],
    issues: [...issues],
  };
}

/** Whether a crop belongs to the run, so a link serves only its own run's crops. */
export async function runHasCrop(tx: TransactionSql, runId: string, ref: string): Promise<boolean> {
  const [row] = await tx<{ found: boolean }[]>`
    select exists (select 1 from findings where run_id = ${runId} and evidence->>'crop' = ${ref})
      as found`;
  return row?.found ?? false;
}
