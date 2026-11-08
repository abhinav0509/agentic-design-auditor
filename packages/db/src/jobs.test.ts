// The fix-job queue (v1.0 §9.1 step 6, §9.2, NFR-03, D-037): one job per mapped finding in a run,
// keyed by (run_id, fingerprint), claimed and finished in Postgres under RLS.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { claimFixJob, enqueueFixJob, finishFixJob, type ClaimedFixJob } from './jobs.ts';
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

it('NFR-03: a job whose worker crashed is claimed once more after its lease runs out, then not again', async () => {
  const runId = await newRun();
  const job = await asApp(db.sql, ORG, (tx) =>
    enqueueFixJob(tx, { orgId: ORG, runId, fingerprint: 'fp-crash' }),
  );
  const claim = () => asApp(db.sql, ORG, (tx) => claimFixJob(tx, { runId }));
  // The worker holding the lease dies; time passes beyond the lease.
  const expire = () =>
    db.sql`update fix_jobs set locked_until = now() - interval '1 second' where id = ${job.id}`;

  await claim();
  await expire();
  const retried = await claim();
  await expire();
  const third = await claim();

  expect(retried).toEqual({ id: job.id, fingerprint: 'fp-crash', attempts: 2 });
  expect(third).toBeNull(); // v1.0 §9.2: one retry
});

it('NFR-03: a job that errors is queued once more, a second error fails it, and success is done', async () => {
  const runId = await newRun();
  const enqueue = (fingerprint: string) =>
    asApp(db.sql, ORG, (tx) => enqueueFixJob(tx, { orgId: ORG, runId, fingerprint }));
  const claim = () => asApp(db.sql, ORG, (tx) => claimFixJob(tx, { runId }));
  // Finishes the job just claimed, as the worker holding it.
  const finish = (job: ClaimedFixJob | null, outcome: 'done' | 'error') =>
    asApp(db.sql, ORG, (tx) =>
      finishFixJob(tx, { id: job?.id ?? '', attempt: job?.attempts ?? 0, outcome }),
    );
  const statusOf = async (id: string) =>
    (await db.sql<{ status: string }[]>`select status from fix_jobs where id = ${id}`)[0]?.status;

  const flaky = await enqueue('fp-flaky');
  await finish(await claim(), 'error');
  const afterFirstError = await statusOf(flaky.id);
  await finish(await claim(), 'error');
  const afterSecondError = await statusOf(flaky.id);

  const fine = await enqueue('fp-fine');
  await finish(await claim(), 'done');

  expect(afterFirstError).toBe('queued'); // v1.0 §9.2: one retry on transient errors
  expect(afterSecondError).toBe('failed');
  expect(await statusOf(fine.id)).toBe('done');
});

it('NFR-03: a job whose last lease runs out is failed, so the run can finish', async () => {
  const runId = await newRun();
  const job = await asApp(db.sql, ORG, (tx) =>
    enqueueFixJob(tx, { orgId: ORG, runId, fingerprint: 'fp-lost' }),
  );
  const claim = () => asApp(db.sql, ORG, (tx) => claimFixJob(tx, { runId }));
  const expire = () =>
    db.sql`update fix_jobs set locked_until = now() - interval '1 second' where id = ${job.id}`;

  await claim();
  await expire();
  await claim();
  await expire();
  const none = await claim();

  expect(none).toBeNull();
  const [row] = await db.sql<
    { status: string }[]
  >`select status from fix_jobs where id = ${job.id}`;
  expect(row?.status).toBe('failed');
});

it('NFR-03: a worker that lost its lease cannot finish the job its successor now holds', async () => {
  const runId = await newRun();
  const job = await asApp(db.sql, ORG, (tx) =>
    enqueueFixJob(tx, { orgId: ORG, runId, fingerprint: 'fp-late' }),
  );
  const claim = () => asApp(db.sql, ORG, (tx) => claimFixJob(tx, { runId }));
  const finish = (attempt: number, outcome: 'done' | 'error') =>
    asApp(db.sql, ORG, (tx) => finishFixJob(tx, { id: job.id, attempt, outcome }));

  const a = await claim(); // worker A
  await db.sql`update fix_jobs set locked_until = now() - interval '1 second' where id = ${job.id}`;
  const b = await claim(); // worker B takes over the retry
  const lateA = await finish(a?.attempts ?? 0, 'done');
  const [during] = await db.sql<
    { status: string }[]
  >`select status from fix_jobs where id = ${job.id}`;
  const byB = await finish(b?.attempts ?? 0, 'done');

  expect(lateA).toBe(false);
  expect(during?.status).toBe('running'); // still B's
  expect(byB).toBe(true);
});
