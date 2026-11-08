// The scan step of a run (v1.0 §9.1 steps 1-4 and 6, FR-05, D-038): each page through the guarded
// browser into Postgres, then the run moves on to fixing. The caller owns the BrowserContext, so the
// sandbox, egress proxy and in-app guard (D-017, D-020) are set up there.
import { DomainError } from '@beacon/core';
import { asApp, savePageScan, type Sql } from '@beacon/db';
import { scanPageContent } from '@beacon/scanner';
import type { BrowserContext } from 'playwright';

/** The MVP page limit per run (FR-05). */
const MAX_PAGES = 10;

export async function scanRun(
  deps: { sql: Sql; context: BrowserContext },
  { orgId, runId, urls }: { orgId: string; runId: string; urls: string[] },
): Promise<void> {
  if (urls.length > MAX_PAGES)
    throw new DomainError('TOO_MANY_PAGES', `a run scans at most ${String(MAX_PAGES)} pages`);
  for (const url of urls) {
    const { served, text, findings } = await scanPageContent(deps.context, url);
    await asApp(deps.sql, orgId, (tx) =>
      savePageScan(tx, { orgId, runId, url, served, text, findings }),
    );
  }
  await asApp(
    deps.sql,
    orgId,
    (tx) => tx`update scan_runs set status = 'fixing' where id = ${runId}`,
  );
}
