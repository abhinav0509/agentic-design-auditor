// The scan step of a run (v1.0 §9.1 steps 1-4 and 6, FR-05, D-038): every page of the run through
// the guarded browser into Postgres, then the run moves on to fixing. Pages are served by Playwright
// routing; every other request is aborted, so no test touches the network.
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import { guardContext } from '@beacon/scanner';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { savePageScan } from '@beacon/db';
import { asApp } from '@beacon/db/testing';
import { FakeLlm, textOnly, toolUse } from '@beacon/agent/testing';
import { InMemoryBlobStore } from '@beacon/core/testing';
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
  // Fixable findings only; reported issues are covered by the FR-29 test below.
  const findings = await db.sql`
    select rule_id, selector from findings where run_id = ${runId} and actionable`;
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

it('FR-05: a page that cannot be scanned is stored with its reason and the run goes on', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  const blocked = 'http://127.0.0.1/admin'; // the URL guard refuses private addresses (NFR-09)
  const unreachable = 'https://down.test/'; // the router aborts it, like a host that is down
  const about = `${ORIGIN}/about`;

  await scanRun(
    { sql: db.sql, context },
    { orgId: ORG, runId, urls: [blocked, unreachable, about] },
  );

  const pages = await db.sql`
    select url, scan_error, served_html is not null as scanned from pages where run_id = ${runId}
    order by url`;
  expect(pages).toEqual([
    { url: blocked, scan_error: 'URL_NOT_ALLOWED', scanned: false },
    { url: unreachable, scan_error: 'SCAN_FAILED', scanned: false },
    { url: about, scan_error: null, scanned: true },
  ]);
  const [status] = await db.sql`select status from scan_runs where id = ${runId}`;
  expect(status).toEqual({ status: 'fixing' });
}, 60_000);

it('FR-29: issues outside the fixable rules reach the database for the report, without fix jobs', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';

  await scanRun({ sql: db.sql, context }, { orgId: ORG, runId, urls: [`${ORIGIN}/`] });

  // The home page has no <main>: axe's best-practice rule, reported but never fixed.
  const reported = await db.sql`
    select rule_id, help, 'best-practice' = any(tags) as best_practice from findings
    where run_id = ${runId} and not actionable and rule_id = 'landmark-one-main'`;
  expect(reported).toEqual([
    {
      rule_id: 'landmark-one-main',
      help: 'Document should have one main landmark',
      best_practice: true,
    },
  ]);
  const [jobs] = await db.sql<{ n: number }[]>`
    select count(*)::int as n from fix_jobs where run_id = ${runId}`;
  expect(jobs?.n).toBe(0);
}, 60_000);

it('FR-29: with a blob store, each croppable flagged element is stored once and its row points at it', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  const blobs = new InMemoryBlobStore();

  await scanRun({ sql: db.sql, context, blobs }, { orgId: ORG, runId, urls: [`${ORIGIN}/`] });

  const rows = await db.sql<{ selector: string; crop: string | null }[]>`
    select selector, evidence->>'crop' as crop from findings where run_id = ${runId}`;
  const cropped = rows.filter((r) => r.crop !== null);
  expect(cropped.length).toBeGreaterThan(0);
  for (const r of cropped) expect(await blobs.get(r.crop ?? '')).not.toBeNull();
  expect(blobs.blobs.size).toBe(new Set(cropped.map((r) => r.crop)).size);
}, 60_000);

it('FR-29: with a reviewer, each page’s flags are saved with their crops and the model cost is recorded', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  const url = `${ORIGIN}/reviewed`;
  PAGES[url] = doc(
    '<main><p><img src="/a.png" alt="IMG_1.jpg" width="60" height="40"></p><p>Prices: <a href="/p">click here</a></p></main>',
  );
  const blobs = new InMemoryBlobStore();
  const llm = new FakeLlm([
    toolUse(['get_image', { id: 'c1' }]),
    toolUse([
      'submit_review',
      {
        flags: [
          {
            id: 'c1',
            kind: 'unhelpful_alt',
            reason: 'A file name.',
            suggestion: 'Potter at the wheel',
          },
          { id: 'c2', kind: 'vague_link', reason: 'Vague.', suggestion: 'See workshop prices' },
        ],
      },
    ]),
  ]);

  await scanRun(
    { sql: db.sql, context, blobs, reviewer: { llm } },
    { orgId: ORG, runId, urls: [url] },
  );

  const flags = await db.sql<{ kind: string; current_text: string; crop: string | null }[]>`
    select kind, current_text, crop from review_flags where run_id = ${runId} order by kind`;
  expect(flags.map((f) => [f.kind, f.current_text])).toEqual([
    ['unhelpful_alt', 'IMG_1.jpg'],
    ['vague_link', 'click here'],
  ]);
  expect(await blobs.get(flags[0]?.crop ?? '')).not.toBeNull();
  expect(flags[1]?.crop).toBeNull();
  const [cost] = await db.sql<{ cost: number }[]>`
    select sum(cost_micros)::int as cost from usage_ledger where run_id = ${runId}`;
  expect(cost?.cost).toBe(100); // two FakeLlm turns at 50 micros each
}, 60_000);

it('FR-29: a review that fails leaves the page stored and unreviewed, with its cost recorded', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  const url = `${ORIGIN}/review-fails`;
  PAGES[url] = doc('<main><p>Prices: <a href="/p">click here</a></p></main>');
  const llm = new FakeLlm([textOnly('thinking'), new Error('overloaded')]);

  await scanRun({ sql: db.sql, context, reviewer: { llm } }, { orgId: ORG, runId, urls: [url] });

  const [page] = await db.sql`select reviewed_at from pages where run_id = ${runId}`;
  expect(page).toEqual({ reviewed_at: null });
  const [flags] = await db.sql<
    { n: number }[]
  >`select count(*)::int as n from review_flags where run_id = ${runId}`;
  expect(flags?.n).toBe(0);
  const [cost] = await db.sql<{ cost: number }[]>`
    select sum(cost_micros)::int as cost from usage_ledger where run_id = ${runId}`;
  expect(cost?.cost).toBe(50);
}, 60_000);
