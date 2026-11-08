// Audit log tamper-evidence (addendum 2.8, FR-16, D-036): proposal_events form one hash chain per
// org, computed by the database on insert, so no writer can skip or forge a link. The formula below
// is the contract an export verifier recomputes.
import { makeProposal } from '@beacon/core/testing';
import type { TransactionSql } from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { saveProposal } from './proposals.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000d1';
const ORG_B = '00000000-0000-4000-8000-0000000000d2';
const ORG_C = '00000000-0000-4000-8000-0000000000d3';

let db: TestDb;
const seeds: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  db = await createTestDb('audit_chain');
  seeds[ORG_A] = await seedOrg(db.sql, ORG_A);
  seeds[ORG_B] = await seedOrg(db.sql, ORG_B);
  seeds[ORG_C] = await seedOrg(db.sql, ORG_C);
});

afterAll(async () => {
  await db.drop();
});

/** Saves a pending proposal for a new finding in org, as the worker does. */
async function saveFor(org: string, n: number): Promise<void> {
  const seed = seeds[org] ?? {};
  const [finding] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
    values (${org}, ${seed['run'] ?? ''}, ${seed['page'] ?? ''}, ${`fp-${String(n)}`}, 'image-alt',
            'critical', 'img', '<img>')
    returning id`;
  if (!finding) throw new Error('no finding inserted');
  const proposalId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  await asApp(db.sql, org, (tx) =>
    saveProposal(tx, {
      orgId: org,
      findingId: finding.id,
      proposal: makeProposal({ proposal_id: proposalId, run_id: seed['run'] }),
      status: 'pending',
    }),
  );
}

it('FR-16: each org has its own unbroken hash chain of proposal events', async () => {
  // Interleave the orgs so a chain that ignored org_id would link across them.
  await saveFor(ORG_A, 201);
  await saveFor(ORG_B, 202);
  await saveFor(ORG_A, 203);

  const rows = await db.sql<
    { org_id: string; prev_hash: Buffer | null; hash: Buffer; expected: Buffer }[]
  >`
    select org_id, prev_hash, hash,
      sha256(coalesce(prev_hash, ''::bytea) || convert_to(jsonb_build_object(
        'id', id, 'org_id', org_id, 'proposal_id', proposal_id, 'from_status', from_status,
        'to_status', to_status, 'actor_type', actor_type, 'actor_id', actor_id, 'reason', reason,
        'data', data, 'created_at', created_at at time zone 'UTC')::text, 'UTF8')) as expected
    from proposal_events order by id`;

  for (const org of [ORG_A, ORG_B]) {
    const chain = rows.filter((r) => r.org_id === org);
    expect(chain).toHaveLength(org === ORG_A ? 3 : 2); // the seed's event plus the saves
    chain.forEach((r, i) => {
      expect(r.prev_hash, `${org} event ${String(i)} links to the one before`).toEqual(
        i === 0 ? null : chain[i - 1]?.hash,
      );
      expect(r.hash, `${org} event ${String(i)} hash recomputes`).toEqual(r.expected);
    });
  }
});

it('FR-16: two writers in one org at the same moment still form one chain', async () => {
  const proposal = seeds[ORG_C]?.['proposal'] ?? '';
  const insertEvent = (tx: TransactionSql) =>
    tx<{ id: string; prev_hash: Buffer | null; hash: Buffer }[]>`
      insert into proposal_events (org_id, proposal_id, to_status, actor_type)
      values (${ORG_C}, ${proposal}, 'pending', 'system')
      returning id, prev_hash, hash`.then((rows) => rows[0]);

  // Writer 1 inserts and holds its transaction open; writer 2 inserts meanwhile.
  const held = Promise.withResolvers<undefined>();
  const inserted = Promise.withResolvers<undefined>();
  const first = asApp(db.sql, ORG_C, async (tx) => {
    const row = await insertEvent(tx);
    inserted.resolve(undefined);
    await held.promise;
    return row;
  });
  await inserted.promise;
  const state = { secondDone: false };
  const second = asApp(db.sql, ORG_C, insertEvent).finally(() => (state.secondDone = true));
  // Release writer 1 once writer 2 is blocked on the org lock, or has already finished without it.
  for (;;) {
    const [w] = await db.sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`;
    if (state.secondDone || (w?.n ?? 0) > 0) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  held.resolve(undefined);

  const [a, b] = await Promise.all([first, second]);
  expect(b?.prev_hash).toEqual(a?.hash);
  expect(Number(b?.id)).toBeGreaterThan(Number(a?.id));
});
