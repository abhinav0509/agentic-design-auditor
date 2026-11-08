// The fix-job queue (v1.0 §9.1 step 6, §9.2, NFR-03, D-037): one job per mapped finding in a run,
// keyed by (run_id, fingerprint), claimed and finished in Postgres under RLS.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { claimFixJob, enqueueFixJob } from './jobs.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000e1';

let db: TestDb;
let seed: Record<string, string>;

beforeAll(async () => {
  db = await createTestDb('jobs');
  seed = await seedOrg(db.sql, ORG);
});

afterAll(async () => {
  await db.drop();
});

it('NFR-03: enqueuing the same finding twice for a run makes one job', async () => {
  const enqueue = () =>
    asApp(db.sql, ORG, (tx) =>
      enqueueFixJob(tx, { orgId: ORG, runId: seed['run'] ?? '', fingerprint: 'fp-1' }),
    );

  const first = await enqueue();
  const again = await enqueue();

  expect(first.created).toBe(true);
  expect(again).toEqual({ id: first.id, created: false });
  // The seed has its own job in this run; count only this finding's.
  const jobs = await db.sql`
    select status, attempts from fix_jobs where run_id = ${seed['run'] ?? ''} and fingerprint = 'fp-1'`;
  expect(jobs).toEqual([{ status: 'queued', attempts: 0 }]);
});

/** A run of its own, so each test sees only the jobs it enqueues. */
async function newRun(): Promise<string> {
  const [row] = await db.sql<{ id: string }[]>`
    insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
      model_name, budget, engine_version)
    values (${ORG}, ${seed['site'] ?? ''}, 'fixing', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0')
    returning id`;
  if (!row) throw new Error('no run inserted');
  return row.id;
}

it('NFR-03: claiming a job leases it for 120 s and counts the attempt', async () => {
  const runId = await newRun();
  const job = await asApp(db.sql, ORG, (tx) =>
    enqueueFixJob(tx, { orgId: ORG, runId, fingerprint: 'fp-claim' }),
  );

  const { claimed, now } = await asApp(db.sql, ORG, async (tx) => {
    const claimed = await claimFixJob(tx, { runId });
    const [t] = await tx<{ now: Date }[]>`select now()`;
    return { claimed, now: t?.now };
  });
  const again = await asApp(db.sql, ORG, (tx) => claimFixJob(tx, { runId }));

  expect(claimed).toEqual({ id: job.id, fingerprint: 'fp-claim', attempts: 1 });
  expect(again).toBeNull(); // its only job is leased
  const [row] = await db.sql<{ status: string; locked_until: Date }[]>`
    select status, locked_until from fix_jobs where id = ${job.id}`;
  expect(row?.status).toBe('running');
  expect(row?.locked_until.getTime()).toBe((now?.getTime() ?? 0) + 120_000);
});
