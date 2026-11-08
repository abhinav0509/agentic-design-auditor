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
