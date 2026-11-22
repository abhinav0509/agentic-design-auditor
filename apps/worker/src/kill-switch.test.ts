// The kill switch in the worker (FR-28, D-057): while an org is paused, no agent work runs: no fix or
// preview job is claimed, the agent review is skipped, and nothing is exported. The scan still runs.
import { FakeLlm } from '@beacon/agent/testing';
import { InMemoryBlobStore } from '@beacon/core/testing';
import { asApp, setAgentPaused } from '@beacon/db';
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import { FakeGitProvider } from '@beacon/exporter/testing';
import { guardContext } from '@beacon/scanner';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { exportRun } from './export-run.ts';
import { previewFixes } from './preview-fixes.ts';
import { runFixJobs } from './run-fix-jobs.ts';
import { scanRun } from './scan-run.ts';

const ORG = '00000000-0000-4000-8000-0000000000ab';
const URL_ = 'https://paused.example/';
const PAGE =
  '<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>Hi</h1><p><img src="/a.png" alt="IMG_1.jpg" width="40" height="30"></p><p><img src="/b.png" width="40" height="30"></p></main></body></html>';
const clock = { now: () => new Date('2026-11-22T12:00:00Z') };
const ids = { uuid: () => crypto.randomUUID() };

let db: TestDb;
let seed: Record<string, string>;
let browser: Browser;
let context: BrowserContext;
let runId: string;

beforeAll(async () => {
  db = await createTestDb('worker_kill_switch');
  seed = await seedOrg(db.sql, ORG);
  browser = await chromium.launch();
  context = await browser.newContext();
  await context.route('**/*', (route) =>
    route.request().url() === URL_
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : route.abort(),
  );
  await guardContext(context, () => Promise.resolve(['93.184.215.14']));
  await asApp(db.sql, ORG, (tx) =>
    setAgentPaused(tx, { paused: true, at: clock.now(), reason: 'test' }),
  );
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  runId = run?.id ?? '';
}, 60_000);
afterAll(async () => {
  await browser.close();
  await db.drop();
});

it('FR-28: while paused, the scan still runs but the agent review does not', async () => {
  const reviewer = new FakeLlm([]);

  await scanRun(
    { sql: db.sql, context, reviewer: { llm: reviewer } },
    { orgId: ORG, runId, urls: [URL_] },
  );

  expect(reviewer.calls).toEqual([]);
  const [pages] = await db.sql<
    { n: number }[]
  >`select count(*)::int as n from pages where run_id = ${runId}`;
  expect(pages?.n).toBe(1);
  const [reviewed] = await db.sql<{ n: number }[]>`
    select count(*)::int as n from pages where run_id = ${runId} and reviewed_at is not null`;
  expect(reviewed?.n).toBe(0);
}, 60_000);

it('FR-28: while paused, fix and preview jobs are not claimed and stay queued', async () => {
  const llm = new FakeLlm([]);

  await runFixJobs(
    { sql: db.sql, browser, llm, clock, ids },
    { orgId: ORG, runId, site: { files: {}, commitSha: 'abc' } },
  );
  await previewFixes(
    { sql: db.sql, browser, llm, clock, ids, blobs: new InMemoryBlobStore() },
    { orgId: ORG, runId },
  );

  expect(llm.calls).toEqual([]);
  const jobs = await db.sql`select status from fix_jobs where run_id = ${runId}`;
  expect(jobs.length).toBeGreaterThan(0);
  expect(jobs.every((j) => j['status'] === 'queued')).toBe(true);
});

it('FR-28: while paused, nothing is exported and GitHub is not touched', async () => {
  const git = new FakeGitProvider({ 'index.html': PAGE });

  const result = await exportRun(
    { sql: db.sql, browser, git, checkout: () => Promise.resolve({}), clock },
    { orgId: ORG, runId },
  );

  expect(result).toEqual({ status: 'paused' });
  expect(git.prs).toEqual([]);
});
