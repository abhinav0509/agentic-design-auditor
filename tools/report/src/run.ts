// The operator report run (D-045): the prospect's org, site and run under RLS, the scan step with
// crops, the run marked ready, and a 14-day share link (FR-27, FR-29, D-041).
import type { BlobStore, Clock } from '@beacon/core';
import { asApp, createReportLink, type Sql } from '@beacon/db';
import { scanRun } from '@beacon/worker';
import axe from 'axe-core';
import type { BrowserContext } from 'playwright';
import type { ReportPlan } from './plan.ts';

export type RunReportDeps = {
  sql: Sql;
  context: BrowserContext;
  blobs: BlobStore;
  clock: Clock;
  /** A new unguessable link token (32+ URL-safe characters). */
  token: () => string;
};

const LINK_DAYS = 14;

export async function runReport(
  deps: RunReportDeps,
  plan: ReportPlan,
): Promise<{ path: string; expiresAt: Date }> {
  const { sql } = deps;
  const orgId = plan.orgId;
  const runId = await asApp(sql, orgId, async (tx) => {
    await tx`
      insert into organizations (id, name) values (${orgId}, ${new URL(plan.siteUrl).host})
      on conflict (id) do nothing`;
    const [found] = await tx<{ id: string }[]>`
      select id from sites where base_url = ${plan.siteUrl} and deleted_at is null limit 1`;
    const siteId =
      found?.id ??
      (
        await tx<{ id: string }[]>`
          insert into sites (org_id, base_url) values (${orgId}, ${plan.siteUrl}) returning id`
      )[0]?.id;
    if (siteId === undefined) throw new Error('site not created');
    // A report run has no repo: no commit, agent or model. The engine version is real.
    const [run] = await tx<{ id: string }[]>`
      insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
        model_name, budget, engine_version, started_at, requested_by)
      values (${orgId}, ${siteId}, 'scanning', 'none', 'none', 'none', 'none', '{}',
        ${`axe-core-${axe.version}`}, ${deps.clock.now()}, ${plan.requestedBy})
      returning id`;
    if (!run) throw new Error('run not created');
    return run.id;
  });

  await scanRun(
    { sql, context: deps.context, blobs: deps.blobs },
    { orgId, runId, urls: plan.urls },
  );

  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + LINK_DAYS * 24 * 60 * 60 * 1000);
  const token = deps.token();
  await asApp(sql, orgId, async (tx) => {
    await tx`update scan_runs set status = 'ready', finished_at = ${now} where id = ${runId}`;
    await createReportLink(tx, { orgId, runId, token, expiresAt });
  });
  return { path: `/r/${token}`, expiresAt };
}
