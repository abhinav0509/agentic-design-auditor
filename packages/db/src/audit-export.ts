// Exporting the audit log (FR-26, NFR-10, D-059). Callers pass a transaction that runs as the app role
// with app.org_id set. Each event carries its canonical text, rebuilt from the stored row the same
// way the chain trigger built it (migrations 0002 and 0003): an unchanged row gives the text that was
// hashed, and a row changed later gives different text, so verifyAuditChain catches it.
import type { AuditEvent } from '@beacon/core';
import type { TransactionSql } from 'postgres';

export async function exportAuditLog(
  tx: TransactionSql,
): Promise<{ orgId: string; events: AuditEvent[] }> {
  const [org] = await tx<{ id: string }[]>`select app_org_id() as id`;
  if (!org?.id) throw new Error('exporting the audit log needs an org');
  const rows = await tx<
    {
      id: string;
      proposal_id: string;
      from_status: string | null;
      to_status: string;
      actor_type: string;
      actor_id: string | null;
      reason: string | null;
      created_at: Date;
      canonical: string;
      prev_hash: string | null;
      hash: string;
    }[]
  >`
    select id, proposal_id, from_status, to_status, actor_type, actor_id, reason, created_at,
      jsonb_build_object(
        'id', id, 'org_id', org_id, 'proposal_id', proposal_id,
        'from_status', from_status, 'to_status', to_status, 'actor_type', actor_type,
        'actor_id', actor_id, 'reason', reason, 'data', data,
        'created_at', created_at at time zone 'UTC')::text as canonical,
      encode(prev_hash, 'hex') as prev_hash, encode(hash, 'hex') as hash
    from proposal_events where org_id = app_org_id() order by id`;
  return {
    orgId: org.id,
    events: rows.map((r) => ({
      id: Number(r.id),
      proposalId: r.proposal_id,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      actorType: r.actor_type,
      actorId: r.actor_id,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
      canonical: r.canonical,
      prevHash: r.prev_hash,
      hash: r.hash,
    })),
  };
}
