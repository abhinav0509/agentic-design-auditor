// The fix-job queue (v1.0 §9.1 step 6, NFR-03, D-037). Callers pass a transaction that already runs
// as the app role with app.org_id set.
import type { TransactionSql } from 'postgres';

/** Queues one fix job for a finding in a run. Enqueuing it again returns the same job. */
export async function enqueueFixJob(
  tx: TransactionSql,
  { orgId, runId, fingerprint }: { orgId: string; runId: string; fingerprint: string },
): Promise<{ id: string; created: boolean }> {
  const [inserted] = await tx<{ id: string }[]>`
    insert into fix_jobs (org_id, run_id, fingerprint) values (${orgId}, ${runId}, ${fingerprint})
    on conflict (run_id, fingerprint) do nothing
    returning id`;
  if (inserted) return { id: inserted.id, created: true };
  const [existing] = await tx<{ id: string }[]>`
    select id from fix_jobs where run_id = ${runId} and fingerprint = ${fingerprint}`;
  if (!existing) throw new Error(`fix job for ${fingerprint} vanished`);
  return { id: existing.id, created: false };
}

/** The v1.0 §9.2 job timeout: a claimed job is leased for this long. */
const LEASE = '120 seconds';

export type ClaimedFixJob = { id: string; fingerprint: string; attempts: number };

/** Takes the oldest queued job of a run, marks it running and leases it; null when none is free. */
export async function claimFixJob(
  tx: TransactionSql,
  { runId }: { runId: string },
): Promise<ClaimedFixJob | null> {
  const [job] = await tx<ClaimedFixJob[]>`
    update fix_jobs set status = 'running', attempts = attempts + 1,
      locked_until = now() + ${LEASE}::interval
    where id = (
      select id from fix_jobs where run_id = ${runId} and status = 'queued'
      order by created_at, id limit 1 for update skip locked)
    returning id, fingerprint, attempts`;
  return job ?? null;
}
