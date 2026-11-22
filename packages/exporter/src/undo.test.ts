// Undo (FR-15, addendum 1.5, D-058): before merge, a revert commit on the beacon/* branch drops the
// fix from its PR; after merge, a revert PR undoes that one commit. The default branch is never
// written, and the branch only ever moves forward.
import { applyEditOps, buildProposal, type EditOp, type Proposal } from '@beacon/core';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exportBatch } from './export.ts';
import { FakeGitProvider } from './fake-git.ts';
import { undoProposal } from './undo.ts';

const RUN = '018f3c1e-0000-7000-8000-000000000001';
const INDEX =
  '<!doctype html>\n<html lang="en">\n<body>\n<img src="a.jpg">\n<p>Hi</p>\n<img src="b.jpg">\n</body>\n</html>\n';
const hash = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;
let seq = 0;
function approved(ops: EditOp[]): Proposal {
  const ids = { uuid: () => `018f3c1e-0000-7000-8000-${String(++seq).padStart(12, '0')}` };
  return buildProposal(
    {
      runId: RUN,
      agent: { name: 'beacon-fixer', version: 'test' },
      finding: {
        ruleId: 'image-alt',
        impact: 'critical',
        selector: 'img',
        pageUrl: 'https://example.com/',
      },
      file: { path: 'index.html', source: INDEX, baseHash: hash(INDEX), commitSha: 'abc1234' },
      context: {
        pageUrl: 'https://example.com/',
        insideForm: false,
        decorativeAgreed: false,
        visualDiffRatio: 0,
      },
      result: {
        kind: 'patch',
        title: `Fix ${String(seq)}`,
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
    { clock: { now: () => new Date('2026-11-22T00:00:00Z') }, ids },
  ).proposal;
}
const altOn = (src: string, value: string) =>
  approved([{ op: 'set_attr', at: INDEX.indexOf(`<img src="${src}`), name: 'alt', value }]);

async function exported() {
  const git = new FakeGitProvider({ 'index.html': INDEX });
  const a = altOn('a', 'A');
  const b = altOn('b', 'B');
  const result = await exportBatch(
    { git, verify: () => Promise.resolve({ ok: true }) },
    { runId: RUN, proposals: [a, b] },
  );
  if (result.status !== 'pr_open') throw new Error('export failed');
  return { git, a, b, branch: result.branch, pr: result.pr };
}

describe('undoProposal', () => {
  it('FR-15: before merge, a revert commit on the branch drops just that fix from the PR', async () => {
    const { git, a, branch, pr } = await exported();
    const before = git.refs.get(branch);

    const r = await undoProposal(git, {
      runId: RUN,
      proposal: a,
      pr: { number: pr.number, branch },
    });

    expect(r).toMatchObject({ status: 'reverted_on_branch', branch });
    const file = git.file(branch, 'index.html') ?? '';
    expect(file).not.toContain('alt="A"');
    expect(file).toContain('alt="B"');
    expect(git.log(branch, 'main').at(-1)?.message).toContain(`Beacon-Revert: ${a.proposal_id}`);
    expect(git.commits.get(git.refs.get(branch) ?? '')?.parent).toBe(before); // a fast-forward
    expect(git.file('main', 'index.html')).toBe(INDEX);
  });

  it('FR-15: after merge, a revert PR from the default branch undoes that fix only', async () => {
    const { git, a, branch, pr } = await exported();
    git.merge(pr.number);

    const r = await undoProposal(git, {
      runId: RUN,
      proposal: a,
      pr: { number: pr.number, branch },
    });

    expect(r).toMatchObject({ status: 'revert_pr_open', pr: { number: 2 } });
    if (r.status !== 'revert_pr_open') return;
    expect(r.branch).toMatch(/^beacon\/018f3c1e\/[0-9a-f]{12}$/);
    const file = git.file(r.branch, 'index.html') ?? '';
    expect(file).not.toContain('alt="A"');
    expect(file).toContain('alt="B"');
    expect(git.prs[1]).toMatchObject({ base: 'main', title: `Revert: ${a.title}` });
  });

  it('FR-15: undoing twice is safe: the second finds the fix already gone', async () => {
    const { git, a, branch, pr } = await exported();
    await undoProposal(git, { runId: RUN, proposal: a, pr: { number: pr.number, branch } });

    expect(
      await undoProposal(git, { runId: RUN, proposal: a, pr: { number: pr.number, branch } }),
    ).toEqual({ status: 'no_longer_applies' });
  });

  it('NFR-01: undo never moves the default branch or a non beacon/* branch', async () => {
    const { git, a, pr } = await exported();
    for (const branch of ['main', 'feature/x']) {
      const err = await undoProposal(git, {
        runId: RUN,
        proposal: a,
        pr: { number: pr.number, branch },
      }).catch((e: unknown) => e);
      expect((err as { code?: string }).code).toBe('BRANCH_NOT_ALLOWED');
    }
    expect(git.file('main', 'index.html')).toBe(INDEX);
  });
});
