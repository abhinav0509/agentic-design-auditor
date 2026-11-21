// Reviewer decisions in Postgres (FR-11, FR-13, FR-16, D-051): core's decide() run against stored
// state, the result written with a version check, so retries replay, stale requests are refused and
// two concurrent approvals cannot both win. The approver is the operator user until sign-in exists.
import { DomainError, type DecisionInput } from '@beacon/core';
import { makeProposal } from '@beacon/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decideProposal, ensureOperator } from './decisions.ts';
import { saveProposal } from './proposals.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000f7';
const AT = '2026-10-30T09:00:00.000Z'; // before the example proposal expires (2026-11-05)
let db: TestDb;
let seed: Record<string, string>;
let operator: string;
let n = 0;

beforeAll(async () => {
  db = await createTestDb('decisions');
  seed = await seedOrg(db.sql, ORG);
  operator = await ensureOperator(db.sql, { orgId: ORG, email: 'operator@beacon.test' });
});
afterAll(async () => {
  await db.drop();
});

/** A fresh pending proposal on its own finding. */
async function pending(): Promise<string> {
  n++;
  const [finding] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
    values (${ORG}, ${seed['run'] ?? ''}, ${seed['page'] ?? ''}, ${`fp-dec-${String(n)}`}, 'image-alt',
      'critical', 'img', '<img>')
    returning id`;
  const proposalId = `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`;
  await asApp(db.sql, ORG, (tx) =>
    saveProposal(tx, {
      orgId: ORG,
      findingId: finding?.id ?? '',
      proposal: makeProposal({ proposal_id: proposalId, run_id: seed['run'] }),
      status: 'pending',
    }),
  );
  return proposalId;
}

const decide = (proposalId: string, input: DecisionInput, at = AT) =>
  asApp(db.sql, ORG, (tx) =>
    decideProposal(tx, { orgId: ORG, proposalId, userId: operator, input, at }),
  );
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e as DomainError).code,
  );

describe('decideProposal', () => {
  it('FR-11: approving a pending proposal moves it to approved at version 2, with one decision and one audit event', async () => {
    const id = await pending();

    const r = await decide(id, { action: 'approve', key: 'k1', expectedVersion: 1 });

    expect(r).toMatchObject({ replayed: false, state: { id, status: 'approved', version: 2 } });
    const [row] = await db.sql`select status, version from proposals where id = ${id}`;
    expect(row).toEqual({ status: 'approved', version: 2 });
    const decisions =
      await db.sql`select action, idempotency_key, user_id from decisions where proposal_id = ${id}`;
    expect(decisions).toEqual([{ action: 'approve', idempotency_key: 'k1', user_id: operator }]);
    const events = await db.sql`
      select from_status, to_status, actor_type, actor_id from proposal_events
      where proposal_id = ${id} order by id`;
    expect(events.at(-1)).toEqual({
      from_status: 'pending',
      to_status: 'approved',
      actor_type: 'user',
      actor_id: operator,
    });
  });

  it('FR-13: a retried request with the same key replays and writes nothing new', async () => {
    const id = await pending();
    await decide(id, { action: 'approve', key: 'k1', expectedVersion: 1 });

    const again = await decide(id, { action: 'approve', key: 'k1', expectedVersion: 1 });

    expect(again).toMatchObject({ replayed: true, state: { status: 'approved', version: 2 } });
    const [counts] = await db.sql<{ d: number; e: number }[]>`
      select (select count(*)::int from decisions where proposal_id = ${id}) as d,
             (select count(*)::int from proposal_events where proposal_id = ${id}) as e`;
    expect(counts).toEqual({ d: 1, e: 2 }); // the save event and the approval
  });

  it('FR-13: a key reused for a different request, a stale version, and an expired proposal are refused', async () => {
    const id = await pending();
    await decide(id, { action: 'approve', key: 'k1', expectedVersion: 1 });

    expect(await codeOf(decide(id, { action: 'reject', key: 'k1', expectedVersion: 1 }))).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    expect(await codeOf(decide(id, { action: 'reject', key: 'k2', expectedVersion: 1 }))).toBe(
      'VERSION_CONFLICT',
    );
    const late = await pending();
    expect(
      await codeOf(
        decide(
          late,
          { action: 'approve', key: 'k1', expectedVersion: 1 },
          '2026-11-06T00:00:00.000Z',
        ),
      ),
    ).toBe('PROPOSAL_EXPIRED');
  });

  it('FR-11: a rejection keeps its reason on the decision and the event', async () => {
    const id = await pending();

    await decide(id, {
      action: 'reject',
      key: 'k1',
      expectedVersion: 1,
      reason: 'The photo is decorative.',
    });

    const [d] = await db.sql`select action, reason from decisions where proposal_id = ${id}`;
    expect(d).toEqual({ action: 'reject', reason: 'The photo is decorative.' });
    const [e] =
      await db.sql`select to_status, reason from proposal_events where proposal_id = ${id} order by id desc limit 1`;
    expect(e).toEqual({ to_status: 'rejected', reason: 'The photo is decorative.' });
  });

  it('FR-13: two concurrent approvals with different keys: exactly one wins, the other is a version conflict', async () => {
    const id = await pending();

    const results = await Promise.allSettled([
      decide(id, { action: 'approve', key: 'a', expectedVersion: 1 }),
      decide(id, { action: 'approve', key: 'b', expectedVersion: 1 }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected');
    expect(((lost as PromiseRejectedResult).reason as DomainError).code).toBe('VERSION_CONFLICT');
    const [d] = await db.sql<
      { n: number }[]
    >`select count(*)::int as n from decisions where proposal_id = ${id}`;
    expect(d?.n).toBe(1);
  });

  it('FR-16: an unknown proposal is refused, and nothing is written for another org', async () => {
    expect(
      await codeOf(
        decide('00000000-0000-4000-8000-00000000dead', {
          action: 'approve',
          key: 'k',
          expectedVersion: 1,
        }),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('ensureOperator', () => {
  it('FR-11: gives one operator user per email, a reviewer in the org, however often it runs', async () => {
    const again = await ensureOperator(db.sql, { orgId: ORG, email: 'operator@beacon.test' });

    expect(again).toBe(operator);
    const [m] =
      await db.sql`select role from memberships where org_id = ${ORG} and user_id = ${operator}`;
    expect(m).toEqual({ role: 'reviewer' });
  });
});
