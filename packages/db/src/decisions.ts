// Reviewer decisions (FR-11, FR-13, FR-16, D-051). core's decide() is pure; this loads its inputs,
// then writes its result under a version check, so a retry replays, a stale request is refused and
// of two concurrent approvals exactly one wins. Callers pass a transaction that runs as the app role
// with app.org_id set.
import {
  decide,
  DomainError,
  type DecisionInput,
  type DecisionResult,
  type RecordedDecision,
  type Status,
} from '@beacon/core';
import type { Sql, TransactionSql } from 'postgres';

/**
 * The operator user for an org until sign-in exists (FR-01): created through the migration
 * connection, since the app role may not create users, and made a reviewer of the org.
 */
export async function ensureOperator(
  sql: Sql,
  { orgId, email }: { orgId: string; email: string },
): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    insert into users (email, name) values (${email}, 'Operator')
    on conflict (email) do update set email = excluded.email
    returning id`;
  if (!user) throw new Error('operator user not created');
  await sql`
    insert into memberships (org_id, user_id, role) values (${orgId}, ${user.id}, 'reviewer')
    on conflict (org_id, user_id) do nothing`;
  return user.id;
}

export async function decideProposal(
  tx: TransactionSql,
  input: { orgId: string; proposalId: string; userId: string; input: DecisionInput; at: string },
): Promise<DecisionResult> {
  const { orgId, proposalId, userId, at } = input;
  const [p] = await tx<{ id: string; status: Status; version: number; expires_at: Date }[]>`
    select id, status, version, expires_at from proposals where id = ${proposalId}`;
  if (!p) throw new DomainError('NOT_FOUND', `no proposal ${proposalId}`);
  const prior = await tx<
    {
      action: RecordedDecision['action'];
      key: string;
      request_hash: string;
      expected_version: number;
      reason: string | null;
      decided_at: Date;
    }[]
  >`
    select action, idempotency_key as key, encode(request_hash, 'hex') as request_hash,
      expected_version, reason, decided_at
    from decisions where proposal_id = ${proposalId} order by decided_at`;

  const result = decide(
    {
      state: { id: p.id, status: p.status, version: p.version },
      expires_at: p.expires_at.toISOString(),
      decisions: prior.map((d) => ({
        proposal_id: p.id,
        user_id: userId,
        action: d.action,
        key: d.key,
        request_hash: d.request_hash,
        expected_version: d.expected_version,
        reason: d.reason,
        answer: null,
        decided_at: d.decided_at.toISOString(),
      })),
    },
    input.input,
    { userId, at },
  );
  if (result.replayed) return result;

  // The version check settles races: a concurrent winner has already moved the version on.
  const moved = await tx`
    update proposals set status = ${result.state.status}, version = ${result.state.version}
    where id = ${proposalId} and version = ${input.input.expectedVersion}`;
  if (moved.count === 0)
    throw new DomainError('VERSION_CONFLICT', 'another decision on this proposal was saved first');

  const d = result.decision;
  await tx`
    insert into decisions (org_id, proposal_id, user_id, action, idempotency_key, expected_version,
      request_hash, reason, decided_at)
    values (${orgId}, ${proposalId}, ${userId}, ${d.action}, ${d.key}, ${d.expected_version},
      decode(${d.request_hash}, 'hex'), ${d.reason}, ${d.decided_at})`;
  for (const e of result.events)
    await tx`
      insert into proposal_events (org_id, proposal_id, from_status, to_status, actor_type,
        actor_id, reason)
      values (${orgId}, ${proposalId}, ${e.from_status}, ${e.to_status}, ${e.actor_type},
        ${e.actor_id}, ${e.reason})`;
  return result;
}
