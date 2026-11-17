// The operator report end to end (D-045): org, site and run under RLS, the scan with crops, a ready
// run and a 14-day link that the report route serves. Pages come from Playwright routing.
import { InMemoryBlobStore } from '@beacon/core/testing';
import { createTestDb, type TestDb } from '@beacon/db/testing';
import { guardContext } from '@beacon/scanner';
import { handleReportRequest } from '@beacon/web';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { planReport } from './plan.ts';
import { runReport } from './run.ts';

const doc = (body: string) =>
  `<!doctype html><html lang="en"><head><title>t</title></head><body><main>${body}</main></body></html>`;
const PAGES: Record<string, string> = {
  'https://acme.test/': doc('<h1>Acme</h1><img src="/hero.png" width="40" height="30">'),
  'https://acme.test/contact': doc(
    '<h1>Contact</h1><a href="/x" style="display:inline-block;width:40px;height:20px"></a>',
  ),
};
const NOW = new Date('2026-11-17T09:00:00Z');
const TOKEN = 'Operatoroperatoroperatoroperatoroperator123';

let db: TestDb;
let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  db = await createTestDb('report_cli');
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => {
    const html = PAGES[route.request().url()];
    return html === undefined
      ? route.abort()
      : route.fulfill({ contentType: 'text/html', body: html });
  });
  await guardContext(context, () => Promise.resolve(['93.184.215.14']));
}, 60_000);
afterAll(async () => {
  await browser.close();
  await db.drop();
});

it(
  'FR-29: an operator run scans the pages, marks the run ready and returns a 14-day link the route serves',
  { timeout: 120_000 },
  async () => {
    const planned = planReport(['--requested-by', 'jo@acme.test', ...Object.keys(PAGES)]);
    if (!planned.ok) throw new Error(planned.error);
    const blobs = new InMemoryBlobStore();
    const deps = { sql: db.sql, context, blobs, clock: { now: () => NOW }, token: () => TOKEN };

    const first = await runReport(deps, planned.plan);
    const again = await runReport({ ...deps, token: () => `${TOKEN}x` }, planned.plan);

    expect(first).toEqual({ path: `/r/${TOKEN}`, expiresAt: new Date('2026-12-01T09:00:00Z') });
    const [run] = await db.sql<{ status: string; n: number }[]>`
    select status, (select count(*)::int from scan_runs) as n from scan_runs order by created_at limit 1`;
    expect(run).toEqual({ status: 'ready', n: 2 });
    const [orgs] = await db.sql<{ orgs: number; sites: number }[]>`
    select (select count(*)::int from organizations) as orgs, (select count(*)::int from sites) as sites`;
    expect(orgs).toEqual({ orgs: 1, sites: 1 }); // a second report for the site reuses its org and site
    expect(again.path).toBe(`/r/${TOKEN}x`);

    const page = await handleReportRequest(
      { sql: db.sql, blobs, clock: { now: () => NOW } },
      first.path,
    );
    expect(page.status).toBe(200);
    expect(String(page.body)).toContain('Images need a text alternative');
    expect(String(page.body)).toContain('Links must have discernible text');
    expect(blobs.blobs.size).toBeGreaterThan(0);
  },
);
