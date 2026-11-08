// Storing a run's scanned pages (v1.0 §9.1 steps 1-4 and 6, FR-05, NFR-03, D-038): the page as
// served and its visible text, its findings with their fingerprints, and one fix job per fingerprint,
// so a crashed run resumes from the database without scanning again.
import { fingerprint, type RawFinding } from '@beacon/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { savePageScan } from './scans.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000f1';
const URL_ = 'https://example.test/about';
const SERVED = '<html><body><img src="a.jpg"><input id="q"></body></html>';

let db: TestDb;
let seed: Record<string, string>;

beforeAll(async () => {
  db = await createTestDb('scans');
  seed = await seedOrg(db.sql, ORG);
});

afterAll(async () => {
  await db.drop();
});

const finding = (rule_id: string, target: string, html: string): RawFinding => ({
  page_url: URL_,
  rule_id,
  impact: 'critical',
  target,
  html,
});

it('FR-05: a scanned page is stored as served with its findings and one job each, once', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'scanning', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  const findings = [
    finding('image-alt', 'img', '<img src="a.jpg">'),
    finding('label', '#q', '<input id="q">'),
  ];
  const save = () =>
    asApp(db.sql, ORG, (tx) =>
      savePageScan(tx, {
        orgId: ORG,
        runId,
        url: URL_,
        served: SERVED,
        text: 'About us',
        findings,
      }),
    );

  await save();
  await save(); // the scan step retried after a crash

  const pages = await db.sql`
    select url, served_html, visible_text from pages where run_id = ${runId}`;
  expect(pages).toEqual([{ url: URL_, served_html: SERVED, visible_text: 'About us' }]);
  const stored = await db.sql`
    select fingerprint, rule_id, selector, html_snippet from findings where run_id = ${runId}
    order by rule_id`;
  expect(stored).toEqual([
    {
      fingerprint: fingerprint(findings[0] as RawFinding),
      rule_id: 'image-alt',
      selector: 'img',
      html_snippet: '<img src="a.jpg">',
    },
    {
      fingerprint: fingerprint(findings[1] as RawFinding),
      rule_id: 'label',
      selector: '#q',
      html_snippet: '<input id="q">',
    },
  ]);
  const jobs = await db.sql`
    select fingerprint, status from fix_jobs where run_id = ${runId} order by fingerprint`;
  expect(jobs).toEqual(
    findings
      .map((f) => ({ fingerprint: fingerprint(f), status: 'queued' }))
      .sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1)),
  );
});
