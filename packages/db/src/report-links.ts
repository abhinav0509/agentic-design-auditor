// Share links for the URL-only report (FR-27, D-044). Callers of create and revoke pass a
// transaction that already runs as the app role with app.org_id set.
import { createHash } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { ProposalSchema } from '@beacon/core';
import type { ReviewFlagRow } from './reviews.ts';
import { asApp } from './session.ts';

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createReportLink(
  tx: TransactionSql,
  {
    orgId,
    runId,
    token,
    expiresAt,
    canReview = false,
  }: {
    orgId: string;
    runId: string;
    token: string;
    expiresAt: Date;
    /** A reviewer link (D-055) may approve, reject and export; a share link only shows. */
    canReview?: boolean;
  },
): Promise<{ id: string }> {
  const [row] = await tx<{ id: string }[]>`
    insert into report_links (org_id, run_id, token_hash, expires_at, can_review)
    values (${orgId}, ${runId}, decode(${hashOf(token)}, 'hex'), ${expiresAt}, ${canReview})
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
  /** Pages the agent reviewed (D-048); a page missing here had no review or it did not finish. */
  reviewedPages: string[];
  reviewFlags: (ReviewFlagRow & { pageUrl: string })[];
  /** The run's proposed fixes, for the reviewer (FR-10, D-054). */
  fixes: {
    id: string;
    status: string;
    title: string;
    rationale: string;
    ruleId: string;
    pageUrl: string;
    file: string;
    diff: string | undefined;
    risk: string | undefined;
    announcedBefore: string | null;
    announcedAfter: string | null;
    crop: string | null;
  }[];
  pullRequests: { number: number; url: string; branch: string; proposalIds: string[] }[];
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
  const reviewed = await tx<{ url: string }[]>`
    select url from pages where run_id = ${runId} and reviewed_at is not null order by url`;
  const flags = await tx<(ReviewFlagRow & { pageUrl: string })[]>`
    select p.url as "pageUrl", r.candidate, r.kind, r.selector, r.current_text as text, r.reason,
      r.suggestion, r.crop
    from review_flags r join pages p on p.id = r.page_id
    where r.run_id = ${runId} order by p.url, r.selector`;
  const proposals = await tx<
    {
      id: string;
      status: string;
      payload: unknown;
      announced_before: string | null;
      announced_after: string | null;
    }[]
  >`
    select id, status, payload, announced_before, announced_after from proposals
    where run_id = ${runId} and kind = 'patch' order by id`;
  // The payload is checked against the contract, so the report never renders a malformed one.
  const valid = proposals.flatMap((p) => {
    const parsed = ProposalSchema.safeParse(p.payload);
    return parsed.success ? [{ ...p, payload: parsed.data }] : [];
  });
  const prs = await tx<
    { pr_number: number; pr_url: string; branch: string; proposal_ids: string[] }[]
  >`
    select e.pr_number, e.pr_url, e.branch, e.proposal_ids from exports e
    where e.status = 'pr_open' and e.proposal_ids && (select coalesce(array_agg(id), '{}') from proposals where run_id = ${runId})
    order by e.created_at`;
  return {
    siteUrl: run.base_url,
    scannedAt: run.scanned_at.toISOString(),
    pages: [...pages],
    issues: [...issues],
    reviewedPages: reviewed.map((r) => r.url),
    reviewFlags: [...flags],
    fixes: valid.map((p) => ({
      id: p.id,
      status: p.status,
      title: p.payload.title,
      rationale: p.payload.rationale,
      ruleId: p.payload.rule.id,
      pageUrl: p.payload.target.page_url,
      file: p.payload.target.file,
      diff: p.payload.change?.diff,
      risk: p.payload.risk?.level,
      announcedBefore: p.announced_before,
      announcedAfter: p.announced_after,
      crop: p.payload.evidence.after_screenshot,
    })),
    pullRequests: prs.map((e) => ({
      number: e.pr_number,
      url: e.pr_url,
      branch: e.branch,
      proposalIds: e.proposal_ids,
    })),
  };
}

/** Whether a crop belongs to the run, so a link serves only its own run's crops. */
export async function runHasCrop(tx: TransactionSql, runId: string, ref: string): Promise<boolean> {
  const [row] = await tx<{ found: boolean }[]>`
    select exists (select 1 from findings where run_id = ${runId} and evidence->>'crop' = ${ref})
      or exists (select 1 from review_flags where run_id = ${runId} and crop = ${ref})
      or exists (select 1 from proposals where run_id = ${runId}
        and payload->'evidence'->>'after_screenshot' = ${ref}) as found`;
  return row?.found ?? false;
}

/** The org and run a reviewer token may act on at `at`; null for share links and anything else. */
export async function resolveReviewLink(
  sql: Sql,
  token: string,
  at: Date,
): Promise<{ orgId: string; runId: string } | null> {
  if (token === '') return null;
  const [row] = await asApp(sql, null, async (tx) => {
    await tx`select set_config('app.report_token_hash', ${hashOf(token)}, true)`;
    return tx<{ org_id: string; run_id: string }[]>`
      select org_id, run_id from report_links
      where can_review and revoked_at is null and expires_at > ${at}`;
  });
  return row ? { orgId: row.org_id, runId: row.run_id } : null;
}
