import { applyEditOps, buildProposal, type EditOp, type Proposal } from '@beacon/core';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exportBatch } from './export.ts';
import { FakeGitProvider } from './fake-git.ts';

const RUN = '018f3c1e-0000-7000-8000-000000000001';
const INDEX = `<!doctype html>
<html lang="en">
<body>
<img src="a.jpg">
<img src="b.jpg">
<p>Hello</p>
</body>
</html>
`;
const at = (source: string, needle: string) => source.indexOf(needle);
const hash = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

let seq = 0;
/** An approved patch proposal for `ops` on `path`, built the way the worker builds one. */
function approved(path: string, source: string, ops: EditOp[], ruleId = 'image-alt'): Proposal {
  const ids = { uuid: () => `018f3c1e-0000-7000-8000-${String(++seq).padStart(12, '0')}` };
  return buildProposal(
    {
      runId: RUN,
      agent: { name: 'beacon-fixer', version: 'test' },
      finding: { ruleId, impact: 'critical', selector: 'img', pageUrl: 'https://example.com/' },
      file: { path, source, baseHash: hash(source), commitSha: 'abc1234' },
      context: {
        pageUrl: 'https://example.com/',
        insideForm: false,
        decorativeAgreed: false,
        visualDiffRatio: 0,
      },
      result: {
        kind: 'patch',
        title: `Fix ${ruleId} in ${path}`,
        rationale: 'The image conveys content.',
        confidence: 0.9,
        ops,
        after: applyEditOps(source, ops),
        verification: {
          status: 'passed',
          violationResolved: true,
          newViolations: 0,
          visualDiffRatio: 0,
        },
      },
    },
    { clock: { now: () => new Date('2026-11-15T00:00:00Z') }, ids },
  ).proposal;
}
const altA = () =>
  approved('index.html', INDEX, [
    { op: 'set_attr', at: at(INDEX, '<img src="a'), name: 'alt', value: 'A' },
  ]);
const verifyOk = () => Promise.resolve({ ok: true });

describe('exportBatch', () => {
  it('FR-14: exports approved proposals as a PR on a new beacon/* branch, one traceable commit each', async () => {
    const git = new FakeGitProvider({ 'index.html': INDEX });
    const p = altA();

    const result = await exportBatch({ git, verify: verifyOk }, { runId: RUN, proposals: [p] });

    expect(result).toMatchObject({ status: 'pr_open', pr: { number: 1 } });
    if (result.status !== 'pr_open') return;
    expect(result.branch).toMatch(/^beacon\/018f3c1e\/[0-9a-f]{12}$/);
    const [commit, ...rest] = git.log(result.branch, 'main');
    expect(rest).toEqual([]);
    expect(commit?.message).toContain(`Beacon-Proposal: ${p.proposal_id}`);
    expect(git.file(result.branch, 'index.html')).toBe(
      INDEX.replace('<img src="a.jpg"', '<img src="a.jpg" alt="A"'),
    );
    expect(git.prs[0]).toMatchObject({ head: result.branch, base: 'main' });
    expect(git.prs[0]?.body).toContain(p.title);
    expect(git.file('main', 'index.html')).toBe(INDEX);
  });

  it('FR-14: repeated calls create the branch and PR once', async () => {
    const git = new FakeGitProvider({ 'index.html': INDEX });
    const input = { runId: RUN, proposals: [altA()] };

    const first = await exportBatch({ git, verify: verifyOk }, input);
    const second = await exportBatch({ git, verify: verifyOk }, input);

    expect(second).toEqual(first);
    expect(git.prs).toHaveLength(1);
    expect([...git.refs.keys()].filter((r) => r.startsWith('beacon/'))).toHaveLength(1);
  });

  it('NFR-03: a crash at any write, then a retry, still gives one branch, one PR and the same tree', async () => {
    const proposals = [altA()];
    const clean = new FakeGitProvider({ 'index.html': INDEX });
    const expected = await exportBatch({ git: clean, verify: verifyOk }, { runId: RUN, proposals });
    if (expected.status !== 'pr_open') throw new Error('clean export failed');
    const writes = 3; // one commit, the branch, the PR

    for (let n = 1; n <= writes; n++) {
      const git = new FakeGitProvider({ 'index.html': INDEX });
      git.crashOnWrite = n;
      await expect(
        exportBatch({ git, verify: verifyOk }, { runId: RUN, proposals }),
      ).rejects.toThrow(/crash/);

      const retry = await exportBatch({ git, verify: verifyOk }, { runId: RUN, proposals });

      expect(retry, `crash at write ${String(n)}`).toEqual(expected);
      expect(git.prs).toHaveLength(1);
      expect(git.file(expected.branch, 'index.html')).toBe(
        clean.file(expected.branch, 'index.html'),
      );
    }
  });
});
