// Saving a fix job's proposal (v1.0 §9.1 step 6, NFR-03): one proposal per finding and attempt,
// however often the job runs. Runs as the app role under RLS, the way the worker will.
import { makeProposal } from '@beacon/core/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { saveProposal } from './proposals.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000c1';
const FIRST = '00000000-0000-4000-8000-000000000101';
const RETRY = '00000000-0000-4000-8000-000000000102';

let db: TestDb;
let seed: Record<string, string>;

beforeAll(async () => {
  db = await createTestDb('proposals');
  seed = await seedOrg(db.sql, ORG);
});

afterAll(async () => {
  await db.drop();
});

/** A finding with no proposal yet (the seeded one already has one). */
async function newFinding(fingerprint: string): Promise<string> {
  const [row] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
    values (${ORG}, ${seed['run'] ?? ''}, ${seed['page'] ?? ''}, ${fingerprint}, 'image-alt',
            'critical', 'img', '<img>')
    returning id`;
  if (!row) throw new Error('no finding inserted');
  return row.id;
}

it('NFR-03: a retried job stores one proposal and one event for its finding, not two', async () => {
  const findingId = await newFinding('fp-retry');
  // A retry runs the fixer again, so it builds a new proposal with a new id.
  const save = (proposalId: string) =>
    asApp(db.sql, ORG, (tx) =>
      saveProposal(tx, {
        orgId: ORG,
        findingId,
        proposal: makeProposal({ proposal_id: proposalId, run_id: seed['run'] }),
        status: 'pending',
      }),
    );

  const first = await save(FIRST);
  const retry = await save(RETRY);

  expect(first).toEqual({ id: FIRST, created: true });
  expect(retry).toEqual({ id: FIRST, created: false });
  const proposals = await db.sql`select id, status from proposals where finding_id = ${findingId}`;
  expect(proposals).toEqual([{ id: FIRST, status: 'pending' }]);
  const events = await db.sql`
    select from_status, to_status, actor_type from proposal_events where proposal_id = ${FIRST}`;
  expect(events).toEqual([{ from_status: null, to_status: 'pending', actor_type: 'agent' }]);
});
