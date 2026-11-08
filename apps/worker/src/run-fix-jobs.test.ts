// The fix step of a run (v1.0 §9.1 step 6, §9.2; FR-07, FR-08, NFR-03; D-039): claim each queued
// job, run the fix job on the stored page and the checkout, save its proposal and finish the job.
// One run end to end, scan to stored proposal. No real model: FakeLlm scripts every turn.
import { FakeLlm, toolUse } from '@beacon/agent/testing';
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import { IMAGES_DIR } from '@beacon/evals';
import { guardContext } from '@beacon/scanner';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runFixJobs } from './run-fix-jobs.ts';
import { scanRun } from './scan-run.ts';

const ORG = '00000000-0000-4000-8000-0000000000a8';
const URL_ = 'https://studio.example/about';
const PAGE = readFileSync(new URL('../clean/about.html', IMAGES_DIR), 'utf8').replace(
  ' alt="Potter shaping a bowl on a wheel"',
  '',
);
const SITE = {
  files: {
    'about.html': PAGE,
    'img/studio.jpg': new Uint8Array(readFileSync(new URL('studio.jpg', IMAGES_DIR))),
  },
  commitSha: 'abc1234',
};
const IMG_AT = PAGE.indexOf('<img');

let next = 0;
const ids = { uuid: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}` };
const clock = { now: () => new Date('2026-11-08T10:00:00.000Z') };

const patchTurn = toolUse([
  'submit_proposal',
  {
    kind: 'patch',
    title: 'Add alt text to the studio photo',
    rationale: 'The photo shows the work of the studio.',
    confidence: 0.9,
    ops: [{ op: 'set_attr', at: IMG_AT, name: 'alt', value: 'Potter shaping a bowl on a wheel' }],
  },
]);

let db: TestDb;
let seed: Record<string, string>;
let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  db = await createTestDb('run_fix_jobs');
  seed = await seedOrg(db.sql, ORG);
  browser = await chromium.launch();
  context = await browser.newContext();
  await context.route('**/*', (route) =>
    route.request().url() === URL_
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : route.abort(),
  );
  // studio.example stands in for a public site; the guard itself is tested in @beacon/scanner.
  await guardContext(context, () => Promise.resolve(['93.184.215.14']));
}, 60_000);

afterAll(async () => {
  await browser.close();
  await db.drop();
});

/** A new run of the about page, scanned and ready to fix. */
async function scannedRun(): Promise<string> {
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'abc1234', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  await scanRun({ sql: db.sql, context }, { orgId: ORG, runId, urls: [URL_] });
  return runId;
}

const fixRun = (runId: string, llm: FakeLlm) =>
  runFixJobs({ sql: db.sql, browser, llm, clock, ids }, { orgId: ORG, runId, site: SITE });

it('FR-08: a scanned run ends with a pending proposal saved, its job done and the run ready', async () => {
  const runId = await scannedRun();

  await fixRun(runId, new FakeLlm([toolUse(['get_image', {}]), patchTurn]));

  const proposals = await db.sql`
    select p.kind, p.status, p.payload->'change'->>'diff' as diff, f.rule_id
    from proposals p join findings f on f.id = p.finding_id where p.run_id = ${runId}`;
  expect(proposals).toMatchObject([{ kind: 'patch', status: 'pending', rule_id: 'image-alt' }]);
  expect(proposals[0]?.['diff']).toContain('alt="Potter shaping a bowl on a wheel"');
  const jobs = await db.sql`select status, attempts from fix_jobs where run_id = ${runId}`;
  expect(jobs).toEqual([{ status: 'done', attempts: 1 }]);
  const [status] = await db.sql`select status from scan_runs where id = ${runId}`;
  expect(status).toEqual({ status: 'ready' });
}, 60_000);

it('NFR-03: a model error is retried once, and the retry saves the proposal', async () => {
  const runId = await scannedRun();

  await fixRun(
    runId,
    new FakeLlm([new Error('529 overloaded'), toolUse(['get_image', {}]), patchTurn]),
  );

  const proposals = await db.sql`select status from proposals where run_id = ${runId}`;
  expect(proposals).toEqual([{ status: 'pending' }]);
  const jobs = await db.sql`select status, attempts from fix_jobs where run_id = ${runId}`;
  expect(jobs).toEqual([{ status: 'done', attempts: 2 }]);
}, 60_000);
