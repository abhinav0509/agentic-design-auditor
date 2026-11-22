// Exporting the audit log (FR-26, NFR-10, D-059): the current org's proposal events in chain order,
// each with the canonical text the database hashed, so the export verifies with SHA-256 alone.
import { verifyAuditChain } from '@beacon/core';
import { makeProposal } from '@beacon/core/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { exportAuditLog } from './audit-export.ts';
import { decideProposal, ensureOperator } from './decisions.ts';
import { saveProposal } from './proposals.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000e4';
const OTHER = '00000000-0000-4000-8000-0000000000e5';
let db: TestDb;
let proposalId: string;

beforeAll(async () => {
  db = await createTestDb('audit_export');
  const seed = await seedOrg(db.sql, ORG);
  await seedOrg(db.sql, OTHER);
  const operator = await ensureOperator(db.sql, { orgId: ORG, email: 'operator@beacon.test' });
  const [finding] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
    values (${ORG}, ${seed['run'] ?? ''}, ${seed['page'] ?? ''}, 'fp-audit', 'image-alt', 'critical', 'img', '<img>')
    returning id`;
  proposalId = '00000000-0000-4000-8000-000000000d01';
  await asApp(db.sql, ORG, async (tx) => {
    await saveProposal(tx, {
      orgId: ORG,
      findingId: finding?.id ?? '',
      proposal: makeProposal({ proposal_id: proposalId, run_id: seed['run'] }),
      status: 'pending',
    });
    await decideProposal(tx, {
      orgId: ORG,
      proposalId,
      userId: operator,
      input: { action: 'reject', key: 'k', expectedVersion: 1, reason: 'Decorative image' },
      at: '2026-10-30T09:00:00.000Z',
    });
  });
});
afterAll(async () => {
  await db.drop();
});

it('FR-26: the export holds only this org’s events, in chain order, and verifies', async () => {
  const log = await asApp(db.sql, ORG, (tx) => exportAuditLog(tx));

  expect(log.orgId).toBe(ORG);
  expect(log.events.map((e) => e.toStatus).slice(-2)).toEqual(['pending', 'rejected']);
  expect(log.events.at(-1)).toMatchObject({
    proposalId,
    reason: 'Decorative image',
    actorType: 'user',
  });
  expect(verifyAuditChain(log.events)).toEqual({ ok: true, events: log.events.length });
});

it('FR-26: an event changed in the database afterwards, past the append-only trigger, no longer verifies', async () => {
  // Even a superuser is stopped by the append-only trigger; an admin who turns triggers off for their
  // session can still edit a row, and the chain is what catches that.
  await db.sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update proposal_events set reason = 'Approved after all' where proposal_id = ${proposalId} and to_status = 'rejected'`;
  });

  const log = await asApp(db.sql, ORG, (tx) => exportAuditLog(tx));
  const check = verifyAuditChain(log.events);

  expect(check.ok).toBe(false);
  if (!check.ok) expect(log.events[check.at]?.proposalId).toBe(proposalId);
});
