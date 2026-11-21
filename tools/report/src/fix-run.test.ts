// The demo flow end to end (FR-10, FR-11, FR-14, D-054): scan a GitHub Pages project page, fix with a
// scripted model, see the fix waiting in the report, approve it as the operator, export it to a fake
// GitHub, and see the report point at the pull request. No real model, no network.
import { FakeLlm, toolUse } from '@beacon/agent/testing';
import { InMemoryBlobStore } from '@beacon/core/testing';
import { createTestDb, type TestDb } from '@beacon/db/testing';
import { IMAGES_DIR } from '@beacon/evals';
import { FakeGitProvider } from '@beacon/exporter/testing';
import { guardContext } from '@beacon/scanner';
import { handleReportRequest } from '@beacon/web';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { approveFixes, createReviewLink, exportFixes } from './fix-run.ts';
import { resolveReviewLink } from '@beacon/db';
import { planFixRun } from './fix-plan.ts';
import { runReport } from './run.ts';

const PAGE = readFileSync(new URL('../clean/about.html', IMAGES_DIR), 'utf8').replace(
  ' alt="Potter shaping a bowl on a wheel"',
  '',
);
const IMAGE = new Uint8Array(readFileSync(new URL('studio.jpg', IMAGES_DIR)));
const NOW = new Date('2026-11-21T12:00:00Z');
const TOKEN = 'Fixdemofixdemofixdemofixdemofixdemofixdemo1';
let next = 0;
const ids = { uuid: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}` };

let db: TestDb;
let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  db = await createTestDb('fix_run');
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) =>
    route.request().url() === 'https://jo.github.io/shop/about.html'
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : route.abort(),
  );
  await guardContext(context, () => Promise.resolve(['93.184.215.14']));
}, 60_000);
afterAll(async () => {
  await browser.close();
  await db.drop();
});

it(
  'FR-14: scan, fix, approve and export: the report follows the fix from waiting to its pull request',
  { timeout: 180_000 },
  async () => {
    const planned = planFixRun(['--repo', 'jo/shop', 'about.html']);
    if (!planned.ok) throw new Error(planned.error);
    const git = new FakeGitProvider({ 'about.html': PAGE });
    const files = { 'about.html': PAGE, 'img/studio.jpg': IMAGE };
    const blobs = new InMemoryBlobStore();
    const clock = { now: () => NOW };
    const llm = new FakeLlm([
      toolUse(['get_image', {}]),
      toolUse([
        'submit_proposal',
        {
          kind: 'patch',
          title: 'Add alt text to the studio photo',
          rationale: 'The photo shows the studio at work.',
          confidence: 0.9,
          ops: [
            {
              op: 'set_attr',
              at: PAGE.indexOf('<img'),
              name: 'alt',
              value: 'Potter shaping a bowl on a wheel',
            },
          ],
        },
      ]),
    ]);
    const page = async (path: string) =>
      String((await handleReportRequest({ sql: db.sql, blobs, clock }, path)).body);

    const { path } = await runReport(
      {
        sql: db.sql,
        context,
        blobs,
        clock,
        token: () => TOKEN,
        fix: {
          llm,
          ids,
          files,
          commitSha: (await git.headSha('main')) ?? '',
          repoFullName: 'jo/shop',
          defaultBranch: 'main',
        },
      },
      planned.plan,
    );
    expect(await page(path)).toContain('Waiting for approval');
    expect(await page(path)).toContain('- img &quot;Potter shaping a bowl on a wheel&quot;');

    const approved = await approveFixes(
      { sql: db.sql, clock },
      { token: TOKEN, operatorEmail: 'operator@beacon.test', which: 'all' },
    );
    expect(approved).toEqual([
      { n: 1, title: 'Add alt text to the studio photo', status: 'approved' },
    ]);

    const result = await exportFixes(
      { sql: db.sql, browser, git, checkout: () => Promise.resolve(files), clock },
      TOKEN,
    );
    expect(result).toMatchObject({ status: 'pr_open', pr: { number: 1 } });
    expect(git.prs).toHaveLength(1);
    expect(await page(path)).toContain('In pull request #1');
  },
);

it('FR-11: a reviewer link for a run comes from its share link, and only it opens the reviewer page', async () => {
  const review = 'Reviewlinkreviewlinkreviewlinkreviewlink123';
  const clock = { now: () => NOW };

  const path = await createReviewLink({ sql: db.sql, clock }, { shareToken: TOKEN, token: review });

  expect(path).toBe(`/review/${review}`);
  expect(await resolveReviewLink(db.sql, review, NOW)).not.toBeNull();
  expect(await resolveReviewLink(db.sql, TOKEN, NOW)).toBeNull();
});
