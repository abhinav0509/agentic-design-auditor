// Fix previews from the URL alone (FR-29, D-056): no repo. The fixer works on the page as served and
// sees images through the scan's crops of the live page; the verifier checks the fix on that copy.
import { FakeLlm, toolUse } from '@beacon/agent/testing';
import { InMemoryBlobStore } from '@beacon/core/testing';
import { asApp, loadReportInput } from '@beacon/db';
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import { IMAGES_DIR } from '@beacon/evals';
import { guardContext } from '@beacon/scanner';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { previewFixes } from './preview-fixes.ts';
import { scanRun } from './scan-run.ts';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const URL_ = 'https://studio.example/about';
const PAGE = readFileSync(new URL('../clean/about.html', IMAGES_DIR), 'utf8').replace(
  ' alt="Potter shaping a bowl on a wheel"',
  '',
);
const IMAGE = readFileSync(new URL('studio.jpg', IMAGES_DIR));
let next = 0;
const ids = { uuid: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}` };
const clock = { now: () => new Date('2026-11-22T10:00:00.000Z') };

let db: TestDb;
let seed: Record<string, string>;
let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  db = await createTestDb('preview_fixes');
  seed = await seedOrg(db.sql, ORG);
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url === URL_) return route.fulfill({ contentType: 'text/html', body: PAGE });
    if (url === 'https://studio.example/img/studio.jpg')
      return route.fulfill({ contentType: 'image/jpeg', body: IMAGE });
    return route.abort();
  });
  await guardContext(context, () => Promise.resolve(['93.184.215.14']));
}, 60_000);
afterAll(async () => {
  await browser.close();
  await db.drop();
});

it('FR-29: with only the URL, a finding gets the fix Beacon would make, verified on a copy of the live page', async () => {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'none', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  const blobs = new InMemoryBlobStore();
  await scanRun({ sql: db.sql, context, blobs }, { orgId: ORG, runId, urls: [URL_] });
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

  await previewFixes({ sql: db.sql, browser, llm, clock, ids, blobs }, { orgId: ORG, runId });

  const input = await asApp(db.sql, ORG, (tx) => loadReportInput(tx, runId));
  expect(input.previews).toEqual([
    expect.objectContaining({
      pageUrl: URL_,
      ruleId: 'image-alt',
      before: '<img src="/img/studio.jpg">',
      after: '<img src="/img/studio.jpg" alt="Potter shaping a bowl on a wheel">',
      announcedBefore: '- img',
      announcedAfter: '- img "Potter shaping a bowl on a wheel"',
      verified: true,
    }),
  ]);
  expect(input.previews[0]?.crop).not.toBeNull();
  // The model saw the live page's image, not an error.
  const imageResult = llm.calls[1]?.messages.find((m) => m.role === 'tool');
  expect(JSON.stringify(imageResult)).toContain('"type":"image"');
  const [status] = await db.sql`select status from scan_runs where id = ${runId}`;
  expect(status).toEqual({ status: 'ready' });
}, 120_000);
