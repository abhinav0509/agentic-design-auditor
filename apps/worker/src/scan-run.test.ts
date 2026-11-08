// The scan step of a run (v1.0 §9.1 steps 1-4 and 6, FR-05, D-038): every page of the run through
// the guarded browser into Postgres, then the run moves on to fixing. Pages are served by Playwright
// routing; every other request is aborted, so no test touches the network.
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import { guardContext } from '@beacon/scanner';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { savePageScan } from '@beacon/db';
import { asApp } from '@beacon/db/testing';
import { scanRun } from './scan-run.ts';

const ORG = '00000000-0000-4000-8000-0000000000a7';
const ORIGIN = 'https://site.test';
const doc = (body: string) =>
  `<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`;
const PAGES: Record<string, string> = {
  [`${ORIGIN}/`]: doc('<h1>Studio</h1>'),
  [`${ORIGIN}/about`]: doc('<p>About</p><img src="team.jpg">'),
};

let db: TestDb;
let seed: Record<string, string>;
let browser: Browser;
let context: BrowserContext;
/** Every URL the browser requested, in order. */
const fetched: string[] = [];

beforeAll(async () => {
  db = await createTestDb('scan_run');
  seed = await seedOrg(db.sql, ORG);
  browser = await chromium.launch();
  context = await browser.newContext();
  await context.route('**/*', (route) => {
    const url = route.request().url();
    fetched.push(url);
    // Any other site.test page is a plain clean page.
    const html = PAGES[url] ?? (url.startsWith(`${ORIGIN}/`) ? doc('<p>Page</p>') : undefined);
    return html === undefined
      ? route.abort()
      : route.fulfill({ contentType: 'text/html', body: html });
  });
  // site.test stands in for a public site; the guard itself is tested in @beacon/scanner.
  await guardContext(context, () => Promise.resolve(['93.184.215.14']));
}, 60_000);

afterAll(async () => {
  await browser.close();
  await db.drop();
});

it('FR-05: scanning a run stores each page as served, queues a job per finding and moves the run to fixing', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';

  await scanRun({ sql: db.sql, context }, { orgId: ORG, runId, urls: Object.keys(PAGES) });

  const pages = await db.sql`
    select url, served_html from pages where run_id = ${runId} order by url`;
  expect(pages).toEqual(Object.entries(PAGES).map(([url, html]) => ({ url, served_html: html })));
  const findings = await db.sql`select rule_id, selector from findings where run_id = ${runId}`;
  expect(findings).toEqual([{ rule_id: 'image-alt', selector: 'img' }]);
  const jobs = await db.sql`select status from fix_jobs where run_id = ${runId}`;
  expect(jobs).toEqual([{ status: 'queued' }]);
  const [status] = await db.sql`select status from scan_runs where id = ${runId}`;
  expect(status).toEqual({ status: 'fixing' });
}, 60_000);

it('FR-05: a run of more than 10 pages is refused before anything is scanned', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  const urls = Array.from({ length: 11 }, (_, i) => `${ORIGIN}/page-${String(i + 1)}`);

  await expect(
    scanRun({ sql: db.sql, context }, { orgId: ORG, runId, urls }),
  ).rejects.toMatchObject({ code: 'TOO_MANY_PAGES' });

  const [counts] = await db.sql<{ pages: number }[]>`
    select count(*)::int as pages from pages where run_id = ${runId}`;
  expect(counts).toEqual({ pages: 0 });
  const [status] = await db.sql`select status from scan_runs where id = ${runId}`;
  expect(status).toEqual({ status: 'queued' });
}, 60_000);

it('NFR-03: a resumed run does not scan again the pages it already stored', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'scanning', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  const [home, about] = Object.keys(PAGES) as [string, string];
  // The worker crashed after storing the home page.
  await asApp(db.sql, ORG, (tx) =>
    savePageScan(tx, {
      orgId: ORG,
      runId,
      url: home,
      served: PAGES[home] ?? '',
      text: 'Studio',
      findings: [],
    }),
  );
  fetched.length = 0;

  await scanRun({ sql: db.sql, context }, { orgId: ORG, runId, urls: [home, about] });

  expect(fetched).not.toContain(home);
  expect(fetched).toContain(about);
  const [status] = await db.sql`select status from scan_runs where id = ${runId}`;
  expect(status).toEqual({ status: 'fixing' });
}, 60_000);
