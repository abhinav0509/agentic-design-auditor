// Audit log tamper-evidence (addendum 2.8, FR-16, D-036): proposal_events form one hash chain per
// org, computed by the database on insert, so no writer can skip or forge a link. The formula below
// is the contract an export verifier recomputes.
import { makeProposal } from '@beacon/core/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { saveProposal } from './proposals.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000d1';
const ORG_B = '00000000-0000-4000-8000-0000000000d2';

let db: TestDb;
const seeds: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  db = await createTestDb('audit_chain');
  seeds[ORG_A] = await seedOrg(db.sql, ORG_A);
  seeds[ORG_B] = await seedOrg(db.sql, ORG_B);
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
