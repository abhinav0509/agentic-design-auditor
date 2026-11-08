// The fix-job queue (v1.0 §9.1 step 6, §9.2, NFR-03, D-037): one job per mapped finding in a run,
// keyed by (run_id, fingerprint), claimed and finished in Postgres under RLS.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { enqueueFixJob } from './jobs.ts';
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
  const jobs =
    await db.sql`select status, attempts from fix_jobs where run_id = ${seed['run'] ?? ''}`;
  expect(jobs).toEqual([{ status: 'queued', attempts: 0 }]);
});
