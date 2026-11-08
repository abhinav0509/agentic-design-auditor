// Storing a run's scanned pages (v1.0 §9.1 steps 1-4 and 6, FR-05, NFR-03, D-038). Callers pass a
// transaction that already runs as the app role with app.org_id set.
import { fingerprint, type RawFinding } from '@beacon/core';
import type { TransactionSql } from 'postgres';
import { enqueueFixJob } from './jobs.ts';

export type PageScan = {
  orgId: string;
  runId: string;
  url: string;
  /** The HTML the scan fetched, and the page's visible text (untrusted content). */
  served: string;
  text: string;
  findings: RawFinding[];
};

/**
 * Stores one scanned page, its findings and one fix job per fingerprint. Saving the same page again
 * (a retried scan step) adds nothing; the same fingerprint on another page shares its job.
 */
export async function savePageScan(tx: TransactionSql, scan: PageScan): Promise<void> {
  const { orgId, runId, url } = scan;
  await tx`
    insert into pages (org_id, run_id, url, served_html, visible_text)
    values (${orgId}, ${runId}, ${url}, ${scan.served}, ${scan.text})
    on conflict (run_id, url) do nothing`;
  const [page] = await tx<{ id: string }[]>`
    select id from pages where run_id = ${runId} and url = ${url}`;
  if (!page) throw new Error(`page ${url} vanished`);

  for (const f of scan.findings) {
    const fp = fingerprint(f);
    await tx`
      insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector,
        html_snippet)
      values (${orgId}, ${runId}, ${page.id}, ${fp}, ${f.rule_id}, ${f.impact}, ${f.target}, ${f.html})
      on conflict (run_id, fingerprint, page_id) do nothing`;
    await enqueueFixJob(tx, { orgId, runId, fingerprint: fp });
  }
}
