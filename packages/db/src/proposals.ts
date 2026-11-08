// Proposal storage for the worker (v1.0 §9.1 step 6, NFR-03, D-035). Callers pass a transaction
// that already runs as the app role with app.org_id set (asApp in tests).
import type { Proposal, Status } from '@beacon/core';
import { createHash } from 'node:crypto';
import type { TransactionSql } from 'postgres';

export type SaveProposalInput = {
  orgId: string;
  findingId: string;
  proposal: Proposal;
  status: Status;
};

/**
 * Stores a fix job's proposal as attempt 1 for its finding, with its first event. A retried job
 * gets the stored proposal back (`created: false`) and writes nothing, so a crash never duplicates.
 */
export async function saveProposal(
  tx: TransactionSql,
  { orgId, findingId, proposal: p, status }: SaveProposalInput,
): Promise<{ id: string; created: boolean }> {
  const inserted = await tx<{ id: string }[]>`
    insert into proposals (id, org_id, run_id, finding_id, kind, status, schema_version, payload,
      risk_level, confidence, base_commit_sha, base_content_hash, target_file_hash, expires_at)
    values (${p.proposal_id}, ${orgId}, ${p.run_id}, ${findingId}, ${p.kind}, ${status},
      ${p.schema_version}, ${tx.json(p)}, ${p.risk?.level ?? null}, ${p.confidence},
      ${p.base.commit_sha}, ${p.base.content_hash}, ${p.base.content_hash}, ${p.expires_at})
    on conflict (run_id, finding_id, attempt) do nothing
    returning id`;
  const id = inserted[0]?.id;
  if (id === undefined) {
    const [existing] = await tx<{ id: string }[]>`
      select id from proposals where run_id = ${p.run_id} and finding_id = ${findingId}
        and attempt = 1`;
    if (!existing) throw new Error(`proposal for finding ${findingId} vanished`);
    return { id: existing.id, created: false };
  }

  const event = { proposal_id: id, from_status: null, to_status: status, actor_type: 'agent' };
  // shortcut: hashes the row alone (prev_hash null); the per-org chain (addendum 2.8) is the next test.
  const hash = createHash('sha256').update(JSON.stringify(event)).digest();
  await tx`
    insert into proposal_events (org_id, proposal_id, from_status, to_status, actor_type, hash)
    values (${orgId}, ${id}, null, ${status}, 'agent', ${hash})`;
  return { id, created: true };
}
