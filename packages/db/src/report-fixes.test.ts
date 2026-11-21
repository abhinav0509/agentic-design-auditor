// The report's proposed fixes (FR-10, FR-29, D-054): each proposal of the run with what a reviewer
// needs to decide, its status, and the PR it went into.
import { blobRef } from '@beacon/core';
import { makeProposal } from '@beacon/core/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { decideProposal, ensureOperator } from './decisions.ts';
import { recordExport } from './exports.ts';
import { saveProposal } from './proposals.ts';
import { loadReportInput } from './report-links.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000f9';
const AT = '2026-10-30T09:00:00.000Z';
let db: TestDb;
let seed: Record<string, string>;

beforeAll(async () => {
  db = await createTestDb('report_fixes');
  seed = await seedOrg(db.sql, ORG);
});
afterAll(async () => {
  await db.drop();
});

it('FR-10: the report input lists each proposal with its diff, risk, evidence and status, and the run’s PRs', async () => {
  const runId = seed['run'] ?? '';
  const crop = blobRef(new Uint8Array([3]), 'image/png');
  const [finding] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
    values (${ORG}, ${runId}, ${seed['page'] ?? ''}, 'fp-fix', 'image-alt', 'critical', 'img', '<img>')
    returning id`;
  const id = '00000000-0000-4000-8000-000000000a01';
  const example = makeProposal({ proposal_id: id, run_id: runId });
  const proposal = makeProposal({
    proposal_id: id,
    run_id: runId,
    evidence: { ...example.evidence, after_screenshot: crop },
  });
  const operator = await ensureOperator(db.sql, { orgId: ORG, email: 'operator@beacon.test' });
  await asApp(db.sql, ORG, async (tx) => {
    await saveProposal(tx, {
      orgId: ORG,
      findingId: finding?.id ?? '',
      proposal,
      status: 'pending',
      announced: { before: '- img', after: '- img "Founder holding the product"' },
    });
    await decideProposal(tx, {
      orgId: ORG,
      proposalId: id,
      userId: operator,
      input: { action: 'approve', key: 'k', expectedVersion: 1 },
      at: AT,
    });
    await recordExport(tx, {
      orgId: ORG,
      runId,
      outcome: {
        status: 'pr_open',
        branch: 'beacon/x/y',
        pr: { number: 4, url: 'https://github.com/jo/shop/pull/4' },
        proposalIds: [id],
      },
      at: AT,
    });
  });

  const input = await asApp(db.sql, ORG, (tx) => loadReportInput(tx, runId));

  expect(input.fixes.find((f) => f.id === id)).toEqual({
    id,
    status: 'applied',
    title: proposal.title,
    rationale: proposal.rationale,
    ruleId: 'image-alt',
    pageUrl: proposal.target.page_url,
    file: proposal.target.file,
    diff: proposal.change?.diff,
    risk: proposal.risk?.level,
    announcedBefore: '- img',
    announcedAfter: '- img "Founder holding the product"',
    crop,
  });
  expect(input.pullRequests).toEqual([
    {
      number: 4,
      url: 'https://github.com/jo/shop/pull/4',
      branch: 'beacon/x/y',
      proposalIds: [id],
    },
  ]);
});
