// The scan step of a run (v1.0 §9.1 steps 1-4 and 6, FR-05, D-038): each page through the guarded
// browser into Postgres, then the run moves on to fixing. The caller owns the BrowserContext, so the
// sandbox, egress proxy and in-app guard (D-017, D-020) are set up there.
import { DomainError } from '@beacon/core';
import { asApp, savePageError, savePageScan, type Sql } from '@beacon/db';
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
  // A resumed run skips the pages it already stored (NFR-03).
  const stored = new Set(
    (
      await asApp(
        deps.sql,
        orgId,
        (tx) => tx<{ url: string }[]>`
        select url from pages where run_id = ${runId}`,
      )
    ).map((p) => p.url),
  );
  for (const url of urls.filter((u) => !stored.has(u))) {
    let page;
    try {
      page = await scanPageContent(deps.context, url);
    } catch (e) {
      // v1.0 §12.3: the page is listed as not scanned with its reason; the run goes on.
      const reason = e instanceof DomainError ? e.code : 'SCAN_FAILED';
      await asApp(deps.sql, orgId, (tx) => savePageError(tx, { orgId, runId, url, reason }));
      continue;
    }
    const { served, text, findings } = page;
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
