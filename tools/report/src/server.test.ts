// The reviewer page in a real browser (FR-11, FR-14, D-055): the server on a free port, a browser
// clicking the page's own buttons. The handler tests assumed what Origin a browser sends; this one
// asks the browser.
import { makeProposal } from '@beacon/core/testing';
import { InMemoryBlobStore } from '@beacon/core/testing';
import { asApp, createReportLink, saveProposal } from '@beacon/db';
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createReportServer } from './server.ts';

const ORG = '00000000-0000-4000-8000-0000000000d6';
const REVIEW = 'Browserreviewbrowserreviewbrowserreview123';
const ID = '00000000-0000-4000-8000-000000000c01';
const NOW = new Date('2026-10-30T09:00:00Z');
let db: TestDb;
let server: Server;
let browser: Browser;
let base: string;
const exported: string[] = [];

beforeAll(async () => {
  db = await createTestDb('report_server');
  const seed = await seedOrg(db.sql, ORG);
  const runId = seed['run'] ?? '';
  const [finding] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
    values (${ORG}, ${runId}, ${seed['page'] ?? ''}, 'fp-browser', 'image-alt', 'critical', 'img', '<img>')
    returning id`;
  await asApp(db.sql, ORG, async (tx) => {
    await saveProposal(tx, {
      orgId: ORG,
      findingId: finding?.id ?? '',
      proposal: makeProposal({ proposal_id: ID, run_id: runId, title: 'Add alt text' }),
      status: 'pending',
    });
    await createReportLink(tx, {
      orgId: ORG,
      runId,
      token: REVIEW,
      expiresAt: new Date('2026-11-29T00:00:00Z'),
      canReview: true,
    });
  });
  server = createReportServer({
    sql: db.sql,
    blobs: new InMemoryBlobStore(),
    clock: { now: () => NOW },
    review: {
      operatorEmail: 'operator@beacon.test',
      undoFix: () => Promise.resolve({ status: 'not_applied' }),
      exportRun: (link) => {
        exported.push(link.runId);
        return Promise.resolve({
          status: 'pr_open',
          pr: { number: 1, url: 'https://github.com/jo/shop/pull/1' },
        });
      },
    },
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser.close();
  await new Promise((done) => server.close(done));
  await db.drop();
});

it(
  'FR-11: clicking Approve in a real browser approves the fix and the page says so',
  { timeout: 60_000 },
  async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/review/${REVIEW}`);

    await page.getByRole('button', { name: /^Approve\b.*Add alt text/ }).click();
    await page.waitForURL(/done=approved/);

    await expect
      .poll(
        async () =>
          (await db.sql<{ status: string }[]>`select status from proposals where id = ${ID}`)[0]
            ?.status,
      )
      .toBe('approved');
    expect(await page.getByRole('status').textContent()).toContain('Fix approved');
    await page.close();
  },
);

it(
  'FR-14: clicking Open a pull request in a real browser exports the run',
  { timeout: 60_000 },
  async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/review/${REVIEW}`);

    await page.getByRole('button', { name: /Open a pull request with 1 approved fix/ }).click();
    await page.waitForURL(/done=exported/);

    expect(exported).toHaveLength(1);
    await page.close();
  },
);
