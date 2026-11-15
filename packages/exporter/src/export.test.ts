import {
  applyEditOps,
  buildProposal,
  DomainError,
  ERROR_CODES,
  type EditOp,
  type Proposal,
} from '@beacon/core';
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
const altB = () =>
  approved('index.html', INDEX, [
    { op: 'set_attr', at: at(INDEX, '<img src="b'), name: 'alt', value: 'B' },
  ]);
const ABOUT = '<html>\n<body><p>About</p></body>\n</html>\n';
const langAbout = () =>
  approved(
    'about.html',
    ABOUT,
    [{ op: 'set_attr', at: 0, name: 'lang', value: 'en' }],
    'html-has-lang',
  );
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

  it('FR-25: verifies the batch as a whole once, with one commit per proposal in a stable order', async () => {
    const git = new FakeGitProvider({ 'index.html': INDEX, 'about.html': ABOUT });
    const proposals = [langAbout(), altB(), altA()]; // a and b are on adjacent lines
    const verified: { path: string; content: string }[][] = [];
    const verify = (files: { path: string; content: string }[]) => {
      verified.push(files);
      return Promise.resolve({ ok: true });
    };

    const result = await exportBatch({ git, verify }, { runId: RUN, proposals });
    const again = await exportBatch(
      { git: new FakeGitProvider({ 'index.html': INDEX, 'about.html': ABOUT }), verify: verifyOk },
      { runId: RUN, proposals: [...proposals].reverse() },
    );

    expect(result.status).toBe('pr_open');
    if (result.status !== 'pr_open') return;
    expect(again).toMatchObject({ branch: result.branch });
    const index = INDEX.replace('a.jpg"', 'a.jpg" alt="A"').replace('b.jpg"', 'b.jpg" alt="B"');
    const about = ABOUT.replace('<html>', '<html lang="en">');
    expect(verified).toEqual([
      [
        { path: 'about.html', content: about },
        { path: 'index.html', content: index },
      ],
    ]);
    const trailers = git
      .log(result.branch, 'main')
      .map((c) => /Beacon-Proposal: (\S+)/.exec(c.message)?.[1]);
    expect(trailers).toEqual(proposals.map((p) => p.proposal_id).sort());
    expect(git.file(result.branch, 'index.html')).toBe(index);
    expect(git.file(result.branch, 'about.html')).toBe(about);
  });

  it('FR-25: proposals whose lines or diff context changed since they were made are apply_failed and nothing is pushed', async () => {
    const changed = INDEX.replace('<img src="a.jpg">', '<img src="a.jpg" class="hero">');
    const git = new FakeGitProvider({ 'index.html': changed });
    const a = altA();
    const b = altB();

    const result = await exportBatch({ git, verify: verifyOk }, { runId: RUN, proposals: [a, b] });

    // b's diff context includes a's line, so b fails too, as `git apply` would.
    expect(result).toEqual({ status: 'apply_failed', proposalIds: [a.proposal_id, b.proposal_id] });
    expect([...git.refs.keys()]).toEqual(['main']);
  });

  it('FR-25: two proposals changing the same line are apply_failed', async () => {
    const git = new FakeGitProvider({ 'index.html': INDEX });
    const first = altA();
    const second = approved('index.html', INDEX, [
      { op: 'set_attr', at: at(INDEX, '<img src="a'), name: 'alt', value: 'Other' },
    ]);

    const result = await exportBatch(
      { git, verify: verifyOk },
      { runId: RUN, proposals: [first, second] },
    );

    expect(result).toEqual({ status: 'apply_failed', proposalIds: [second.proposal_id] });
  });

  it('FR-25: when the combined batch fails verification nothing is pushed', async () => {
    const git = new FakeGitProvider({ 'index.html': INDEX });
    const verify = () => Promise.resolve({ ok: false });

    const result = await exportBatch({ git, verify }, { runId: RUN, proposals: [altA(), altB()] });

    expect(result).toEqual({ status: 'verification_failed' });
    expect([...git.refs.keys()]).toEqual(['main']);
    expect(git.commits.size).toBe(1);
  });

  describe('NFR-01: never writes the default branch or a non beacon/* branch', () => {
    const refused = async (git: FakeGitProvider, runId = RUN, proposals = [altA()]) => {
      const before = new Map(git.refs);
      const error: unknown = await exportBatch(
        { git, verify: verifyOk },
        { runId, proposals },
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('BRANCH_NOT_ALLOWED');
      expect(git.refs).toEqual(before);
      expect(git.prs).toEqual([]);
    };

    it('NFR-01: has a stable error code', () => {
      expect(ERROR_CODES).toContain('BRANCH_NOT_ALLOWED');
    });

    it('NFR-01: refuses when the live default branch is the export branch, looked up on every call', async () => {
      const git = new FakeGitProvider({ 'index.html': INDEX });
      const proposals = [altA()];
      const done = await exportBatch({ git, verify: verifyOk }, { runId: RUN, proposals });
      if (done.status !== 'pr_open') throw new Error('first export failed');
      git.defaultName = done.branch; // renamed after the first call, so a cached name would miss it
      git.prs.length = 0;

      await refused(git, RUN, proposals);
    });

    it.each(['../../main', 'x/../../', 'MAIN0000', 'a b c d ', ''])(
      'NFR-01: refuses a run id that would not give a beacon/<hex>/<hex> ref (%j)',
      async (runId) => {
        await refused(new FakeGitProvider({ 'index.html': INDEX }), runId);
      },
    );
  });
});
