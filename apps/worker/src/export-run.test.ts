// Export a run (FR-14, FR-25, D-053), end to end: scan, fix with a scripted model, approve as the
// operator, then export: the real exporter, the real verifier re-checking the combined change, and a
// fake GitHub. No real model, no network.
import { FakeLlm, toolUse } from '@beacon/agent/testing';
import { asApp, decideProposal, ensureOperator } from '@beacon/db';
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import { IMAGES_DIR } from '@beacon/evals';
import { FakeGitProvider } from '@beacon/exporter/testing';
import { guardContext } from '@beacon/scanner';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { exportRun } from './export-run.ts';
import { runFixJobs } from './run-fix-jobs.ts';
import { scanRun } from './scan-run.ts';

const ORG = '00000000-0000-4000-8000-0000000000a9';
const URL_ = 'https://studio.example/about';
const PAGE = readFileSync(new URL('../clean/about.html', IMAGES_DIR), 'utf8').replace(
  ' alt="Potter shaping a bowl on a wheel"',
  '',
);
const IMAGE = new Uint8Array(readFileSync(new URL('studio.jpg', IMAGES_DIR)));
const IMG_AT = PAGE.indexOf('<img');
const AT = '2026-11-08T10:00:00.000Z';
let next = 0;
const ids = { uuid: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}` };
const clock = { now: () => new Date(AT) };

let db: TestDb;
let seed: Record<string, string>;
let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  db = await createTestDb('export_run');
  seed = await seedOrg(db.sql, ORG);
  browser = await chromium.launch();
  context = await browser.newContext();
  await context.route('**/*', (route) =>
    route.request().url() === URL_
      ? route.fulfill({ contentType: 'text/html', body: PAGE })
      : route.abort(),
  );
  await guardContext(context, () => Promise.resolve(['93.184.215.14']));
}, 60_000);
afterAll(async () => {
  await browser.close();
  await db.drop();
});

it('FR-14: an approved, verified fix becomes a PR on a beacon/* branch, and its proposal is applied', async () => {
  const git = new FakeGitProvider({ 'about.html': PAGE });
  const head = (await git.headSha('main')) ?? '';
  const site = { files: { 'about.html': PAGE, 'img/studio.jpg': IMAGE }, commitSha: head };
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'queued', ${head}, 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  const runId = run?.id ?? '';
  await scanRun({ sql: db.sql, context }, { orgId: ORG, runId, urls: [URL_] });
  const llm = new FakeLlm([
    toolUse(['get_image', {}]),
    toolUse([
      'submit_proposal',
      {
        kind: 'patch',
        title: 'Add alt text to the studio photo',
        rationale: 'The photo shows the work of the studio.',
        confidence: 0.9,
        ops: [
          { op: 'set_attr', at: IMG_AT, name: 'alt', value: 'Potter shaping a bowl on a wheel' },
        ],
      },
    ]),
  ]);
  await runFixJobs({ sql: db.sql, browser, llm, clock, ids }, { orgId: ORG, runId, site });
  const operator = await ensureOperator(db.sql, { orgId: ORG, email: 'operator@beacon.test' });
  const [p] = await db.sql<
    { id: string }[]
  >`select id from proposals where run_id = ${runId} and status = 'pending'`;
  await asApp(db.sql, ORG, (tx) =>
    decideProposal(tx, {
      orgId: ORG,
      proposalId: p?.id ?? '',
      userId: operator,
      input: { action: 'approve', key: 'k1', expectedVersion: 1 },
      at: AT,
    }),
  );

  const result = await exportRun(
    { sql: db.sql, browser, git, checkout: () => Promise.resolve(site.files), clock },
    { orgId: ORG, runId },
  );

  expect(result).toMatchObject({ status: 'pr_open', pr: { number: 1 } });
  expect(git.prs[0]?.body).toContain('Add alt text to the studio photo');
  if (result.status !== 'pr_open') return;
  expect(git.file(result.branch, 'about.html')).toContain('alt="Potter shaping a bowl on a wheel"');
  expect(git.file('main', 'about.html')).toBe(PAGE);
  const [row] = await db.sql`select status from proposals where id = ${p?.id ?? ''}`;
  expect(row).toEqual({ status: 'applied' });
  const [exp] = await db.sql`select status, pr_number from exports where branch = ${result.branch}`;
  expect(exp).toEqual({ status: 'pr_open', pr_number: 1 });
}, 120_000);

it('FR-14: with nothing approved there is nothing to export, and GitHub is not touched', async () => {
  const git = new FakeGitProvider({ 'about.html': PAGE });
  const [run] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'ready', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;

  const result = await exportRun(
    { sql: db.sql, browser, git, checkout: () => Promise.resolve({}), clock },
    { orgId: ORG, runId: run?.id ?? '' },
  );

  expect(result).toEqual({ status: 'nothing_to_export' });
  expect(git.prs).toEqual([]);
});
