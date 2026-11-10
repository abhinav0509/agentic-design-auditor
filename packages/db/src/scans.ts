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
  /** As the scanner reports them, with the engine's own rule id (the verifier needs it). */
  findings: (RawFinding & { engine_rule: string })[];
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
      insert into findings (org_id, run_id, page_id, fingerprint, rule_id, engine_rule, impact,
        selector, html_snippet)
      values (${orgId}, ${runId}, ${page.id}, ${fp}, ${f.rule_id}, ${f.engine_rule}, ${f.impact},
        ${f.target}, ${f.html})
      on conflict (run_id, fingerprint, page_id) do nothing`;
    await enqueueFixJob(tx, { orgId, runId, fingerprint: fp });
  }
}

/** Stores a page that could not be scanned, with its reason (a stable error code), once. */
export async function savePageError(
  tx: TransactionSql,
  { orgId, runId, url, reason }: { orgId: string; runId: string; url: string; reason: string },
): Promise<void> {
  await tx`
    insert into pages (org_id, run_id, url, scan_error) values (${orgId}, ${runId}, ${url}, ${reason})
    on conflict (run_id, url) do nothing`;
}

/** What a fix job works on: its finding (first page in URL order) and that page as scanned. */
export type FixJobInput = {
  findingId: string;
  finding: {
    page_url: string;
    rule_id: string;
    engine_rule: string;
    impact: string;
    target: string;
    html: string;
  };
  page: { url: string; served: string; text: string };
};

export async function loadFixJob(
  tx: TransactionSql,
  { runId, fingerprint: fp }: { runId: string; fingerprint: string },
): Promise<FixJobInput> {
  const [row] = await tx<
    {
      id: string;
      rule_id: string;
      engine_rule: string;
      impact: string;
      selector: string;
      html_snippet: string;
      url: string;
      served_html: string;
      visible_text: string;
    }[]
  >`
    select f.id, f.rule_id, f.engine_rule, f.impact, f.selector, f.html_snippet,
      p.url, p.served_html, p.visible_text
    from findings f join pages p on p.id = f.page_id
    where f.run_id = ${runId} and f.fingerprint = ${fp}
    order by p.url limit 1`;
  if (!row) throw new Error(`no finding for fix job ${fp}`);
  return {
    findingId: row.id,
    finding: {
      page_url: row.url,
      rule_id: row.rule_id,
      engine_rule: row.engine_rule,
      impact: row.impact,
      target: row.selector,
      html: row.html_snippet,
    },
    page: { url: row.url, served: row.served_html, text: row.visible_text },
  };
}
