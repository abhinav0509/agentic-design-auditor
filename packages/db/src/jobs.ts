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
/** The first run plus v1.0 §9.2's one retry. */
const MAX_ATTEMPTS = 2;

export type ClaimedFixJob = { id: string; fingerprint: string; attempts: number };

/**
 * Takes the oldest free job of a run, marks it running and leases it; null when none is free. A job
 * whose lease ran out (its worker died) is free again while it has attempts left.
 */
export async function claimFixJob(
  tx: TransactionSql,
  { runId }: { runId: string },
): Promise<ClaimedFixJob | null> {
  // A job that lost its last lease will never be claimed again; fail it so the run can finish.
  await tx`
    update fix_jobs set status = 'failed', locked_until = null
    where run_id = ${runId} and status = 'running' and locked_until < now()
      and attempts >= ${MAX_ATTEMPTS}`;
  const [job] = await tx<ClaimedFixJob[]>`
    update fix_jobs set status = 'running', attempts = attempts + 1,
      locked_until = now() + ${LEASE}::interval
    where id = (
      select id from fix_jobs where run_id = ${runId}
        and (status = 'queued'
          or (status = 'running' and locked_until < now() and attempts < ${MAX_ATTEMPTS}))
      order by created_at, id limit 1 for update skip locked)
    returning id, fingerprint, attempts`;
  return job ?? null;
}

/**
 * Ends a claimed job. `error` is for transient failures only (model timeout, outage): the job goes
 * back to the queue while it has attempts left, else it fails. A guard failure, an unmapped finding
 * or a needs_input answer is a finished job (`done`), never retried (v1.0 §9.2).
 * `attempt` is the one the caller claimed. Returns false, changing nothing, when the caller no longer
 * holds the job (its lease ran out and another worker took it); the caller drops its result.
 */
export async function finishFixJob(
  tx: TransactionSql,
  { id, attempt, outcome }: { id: string; attempt: number; outcome: 'done' | 'error' },
): Promise<boolean> {
  const rows = await tx`
    update fix_jobs set locked_until = null, status = case
      when ${outcome} = 'done' then 'done'
      when attempts < ${MAX_ATTEMPTS} then 'queued'
      else 'failed' end
    where id = ${id} and status = 'running' and attempts = ${attempt}`;
  return rows.count === 1;
}
