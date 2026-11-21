// Exports in Postgres (FR-14, FR-16, D-053): the run's approved proposals for the exporter, and its
// outcome written back: a PR moves them to applied with a system event and an exports row; a patch
// that no longer applies moves them to apply_failed. A retried write changes nothing.
import { makeProposal } from '@beacon/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decideProposal, ensureOperator } from './decisions.ts';
import { loadApproved, recordExport } from './exports.ts';
import { saveProposal } from './proposals.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000f8';
const AT = '2026-10-30T09:00:00.000Z';
let db: TestDb;
let seed: Record<string, string>;
let operator: string;
let n = 0;

beforeAll(async () => {
  db = await createTestDb('exports');
  seed = await seedOrg(db.sql, ORG);
  operator = await ensureOperator(db.sql, { orgId: ORG, email: 'operator@beacon.test' });
});
afterAll(async () => {
  await db.drop();
});

/** A proposal on its own finding, approved when asked. */
async function proposal(approve: boolean): Promise<string> {
  n++;
  const [finding] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, engine_rule, impact, selector, html_snippet)
    values (${ORG}, ${seed['run'] ?? ''}, ${seed['page'] ?? ''}, ${`fp-exp-${String(n)}`}, 'label',
      'select-name', 'critical', 'select', '<select>')
    returning id`;
  const id = `00000000-0000-4000-8000-${String(800 + n).padStart(12, '0')}`;
  await asApp(db.sql, ORG, async (tx) => {
    await saveProposal(tx, {
      orgId: ORG,
      findingId: finding?.id ?? '',
      proposal: makeProposal({ proposal_id: id, run_id: seed['run'] }),
      status: 'pending',
    });
    if (approve)
      await decideProposal(tx, {
        orgId: ORG,
        proposalId: id,
        userId: operator,
        input: { action: 'approve', key: 'k', expectedVersion: 1 },
        at: AT,
      });
  });
  return id;
}
const runId = () => seed['run'] ?? '';

describe('exports', () => {
  it('FR-14: loads the run’s approved proposals with their engine rule and version, and nothing else', async () => {
    const approved = await proposal(true);
    await proposal(false);

    const loaded = await asApp(db.sql, ORG, (tx) => loadApproved(tx, runId()));

    expect(loaded.map((l) => [l.proposal.proposal_id, l.engineRule, l.version])).toContainEqual([
      approved,
      'select-name',
      2,
    ]);
    expect(loaded.every((l) => l.version === 2)).toBe(true);
  });

  it('FR-14: a PR moves its proposals to applied with a system event and records the export, once', async () => {
    const a = await proposal(true);
    const b = await proposal(true);
    const outcome = {
      status: 'pr_open' as const,
      branch: 'beacon/00000000/aaaaaaaaaaaa',
      pr: { number: 3, url: 'https://github.com/jo/shop/pull/3' },
      proposalIds: [a, b],
    };

    await asApp(db.sql, ORG, (tx) =>
      recordExport(tx, { orgId: ORG, runId: runId(), outcome, at: AT }),
    );
    await asApp(db.sql, ORG, (tx) =>
      recordExport(tx, { orgId: ORG, runId: runId(), outcome, at: AT }),
    );

    const rows =
      await db.sql`select status, version from proposals where id in ${db.sql([a, b])} order by id`;
    expect(rows).toEqual([
      { status: 'applied', version: 3 },
      { status: 'applied', version: 3 },
    ]);
    const events =
      await db.sql`select to_status, actor_type from proposal_events where proposal_id = ${a} order by id`;
    expect(events.at(-1)).toEqual({ to_status: 'applied', actor_type: 'system' });
    const exports =
      await db.sql`select kind, branch, pr_number, pr_url, status, proposal_ids from exports where branch = ${outcome.branch}`;
    expect(exports).toEqual([
      {
        kind: 'pull_request',
        branch: outcome.branch,
        pr_number: 3,
        pr_url: outcome.pr.url,
        status: 'pr_open',
        proposal_ids: [a, b],
      },
    ]);
  });

  it('FR-14: a patch that no longer applies moves only its proposals to apply_failed', async () => {
    const failed = await proposal(true);
    const other = await proposal(true);

    await asApp(db.sql, ORG, (tx) =>
      recordExport(tx, {
        orgId: ORG,
        runId: runId(),
        outcome: { status: 'apply_failed', proposalIds: [failed] },
        at: AT,
      }),
    );

    const rows =
      await db.sql`select id, status from proposals where id in ${db.sql([failed, other])} order by id`;
    expect(rows).toEqual([
      { id: failed, status: 'apply_failed' },
      { id: other, status: 'approved' },
    ]);
  });
});
