// Undo a fix (FR-15, D-058), end to end over the database and a fake GitHub: an applied fix in an open
// PR is reverted on its branch; once merged, a revert PR is opened; either way the fix is reverted in
// the audit log, and a paused org undoes nothing.
import { applyEditOps, buildProposal, type Proposal } from '@beacon/core';
import {
  asApp,
  decideProposal,
  ensureOperator,
  recordExport,
  saveProposal,
  setAgentPaused,
} from '@beacon/db';
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import { exportBatch } from '@beacon/exporter';
import { FakeGitProvider } from '@beacon/exporter/testing';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { undoFix } from './undo-fix.ts';

const ORG = '00000000-0000-4000-8000-0000000000ac';
const INDEX = '<!doctype html>\n<html lang="en">\n<body>\n<img src="a.jpg">\n</body>\n</html>\n';
const AT = '2026-10-30T09:00:00.000Z';
const clock = { now: () => new Date(AT) };
let db: TestDb;
let seed: Record<string, string>;
let operator: string;
let n = 0;

beforeAll(async () => {
  db = await createTestDb('undo_fix');
  seed = await seedOrg(db.sql, ORG);
  operator = await ensureOperator(db.sql, { orgId: ORG, email: 'operator@beacon.test' });
});
afterAll(async () => {
  await db.drop();
});

/** An applied fix: saved, approved, exported to a fake GitHub and recorded. */
async function applied(): Promise<{ git: FakeGitProvider; proposal: Proposal; pr: number }> {
  n++;
  const runId = seed['run'] ?? '';
  const ops = [{ op: 'set_attr' as const, at: INDEX.indexOf('<img'), name: 'alt', value: 'A' }];
  const proposal = buildProposal(
    {
      runId,
      agent: { name: 'beacon-fixer', version: 't' },
      finding: {
        ruleId: 'image-alt',
        impact: 'critical',
        selector: 'img',
        pageUrl: 'https://example.test/',
      },
      file: {
        path: 'index.html',
        source: INDEX,
        baseHash: `sha256:${createHash('sha256').update(INDEX).digest('hex')}`,
        commitSha: 'abc1234',
      },
      context: {
        pageUrl: 'https://example.test/',
        insideForm: false,
        decorativeAgreed: false,
        visualDiffRatio: 0,
      },
      result: {
        kind: 'patch',
        title: 'Add alt',
        rationale: 'Why.',
        confidence: 0.9,
        ops,
        after: applyEditOps(INDEX, ops),
        verification: {
          status: 'passed',
          violationResolved: true,
          newViolations: 0,
          visualDiffRatio: 0,
        },
      },
    },
    {
      clock: { now: () => new Date('2026-10-29T00:00:00Z') },
      ids: {
        uuid: () => `00000000-0000-4000-8000-${String(700 + n * 2 + (++n % 1)).padStart(12, '0')}`,
      },
    },
  ).proposal;
  const [finding] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
    values (${ORG}, ${runId}, ${seed['page'] ?? ''}, ${`fp-undo-${String(n)}`}, 'image-alt', 'critical', 'img', '<img>')
    returning id`;
  const git = new FakeGitProvider({ 'index.html': INDEX });
  const exported = await exportBatch(
    { git, verify: () => Promise.resolve({ ok: true }) },
    { runId, proposals: [proposal] },
  );
  if (exported.status !== 'pr_open') throw new Error('export failed');
  await asApp(db.sql, ORG, async (tx) => {
    await saveProposal(tx, {
      orgId: ORG,
      findingId: finding?.id ?? '',
      proposal,
      status: 'pending',
    });
    await decideProposal(tx, {
      orgId: ORG,
      proposalId: proposal.proposal_id,
      userId: operator,
      input: { action: 'approve', key: 'k', expectedVersion: 1 },
      at: AT,
    });
    await recordExport(tx, {
      orgId: ORG,
      runId,
      outcome: {
        status: 'pr_open',
        branch: exported.branch,
        pr: exported.pr,
        proposalIds: [proposal.proposal_id],
      },
      at: AT,
    });
  });
  return { git, proposal, pr: exported.pr.number };
}
const statusOf = async (id: string) =>
  (await db.sql<{ status: string }[]>`select status from proposals where id = ${id}`)[0]?.status;

it('FR-15: undoing a fix in an open PR reverts it on its branch and records who asked', async () => {
  const { git, proposal } = await applied();

  const r = await undoFix(
    { sql: db.sql, git, clock },
    { orgId: ORG, proposalId: proposal.proposal_id, userId: operator },
  );

  expect(r.status).toBe('reverted_on_branch');
  expect(await statusOf(proposal.proposal_id)).toBe('reverted');
  const [e] =
    await db.sql`select to_status, actor_type, actor_id from proposal_events where proposal_id = ${proposal.proposal_id} order by id desc limit 1`;
  expect(e).toEqual({ to_status: 'reverted', actor_type: 'user', actor_id: operator });
});

it('FR-15: undoing a merged fix opens a revert PR and records it as an export', async () => {
  const { git, proposal, pr } = await applied();
  git.merge(pr);

  const r = await undoFix(
    { sql: db.sql, git, clock },
    { orgId: ORG, proposalId: proposal.proposal_id, userId: operator },
  );

  expect(r.status).toBe('revert_pr_open');
  expect(await statusOf(proposal.proposal_id)).toBe('reverted');
  const [exp] =
    await db.sql`select kind, status from exports where ${proposal.proposal_id} = any(proposal_ids) and kind = 'revert_pull_request'`;
  expect(exp).toEqual({ kind: 'revert_pull_request', status: 'pr_open' });
});

it('FR-28: a paused org undoes nothing', async () => {
  const { git, proposal } = await applied();
  await asApp(db.sql, ORG, (tx) => setAgentPaused(tx, { paused: true, at: new Date(AT) }));

  const r = await undoFix(
    { sql: db.sql, git, clock },
    { orgId: ORG, proposalId: proposal.proposal_id, userId: operator },
  );

  expect(r).toEqual({ status: 'paused' });
  expect(await statusOf(proposal.proposal_id)).toBe('applied');
  await asApp(db.sql, ORG, (tx) => setAgentPaused(tx, { paused: false, at: new Date(AT) }));
});
