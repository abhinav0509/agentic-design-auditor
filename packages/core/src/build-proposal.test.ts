// The proposal builder (v1.0 §7.2, §8.1, D-032): fixer output + verification -> a schema-valid
// proposal and its initial status. Pure: the clock and ids are injected.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProposal, type BuildInput } from './build-proposal.ts';
import { applyEditOps, type EditOp } from './edit-ops.ts';
import { parseProposal } from './proposal.ts';
import { catchError } from './test-helpers.ts';

const SOURCE = `<!doctype html>
<html lang="en">
<head><title>About</title></head>
<body>
<main>
<h1>About the studio</h1>
<img src="/img/studio.jpg">
<p>We started with one kiln.</p>
</main>
</body>
</html>
`;
const at = (s: string, needle: string) => s.indexOf(needle);
const ALT: EditOp[] = [
  { op: 'set_attr', at: at(SOURCE, '<img'), name: 'alt', value: 'Potter shaping a bowl' },
];

let next = 0;
const ids = { uuid: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}` };
const clock = { now: () => new Date('2026-11-01T10:00:00.000Z') };
const passed = {
  status: 'passed' as const,
  violationResolved: true,
  newViolations: 0,
  visualDiffRatio: 0,
};

const input = (over: Partial<BuildInput> = {}): BuildInput => ({
  runId: '11111111-1111-4111-8111-111111111111',
  agent: { name: 'beacon-fixer', version: '3' },
  finding: {
    ruleId: 'image-alt',
    impact: 'critical',
    selector: 'main > img',
    pageUrl: 'https://example.com/about',
  },
  file: {
    path: 'about.html',
    source: SOURCE,
    baseHash: `sha256:${'a'.repeat(64)}`,
    commitSha: 'abc1234',
  },
  context: {
    pageUrl: 'https://example.com/about',
    insideForm: false,
    decorativeAgreed: false,
    visualDiffRatio: 0,
  },
  result: {
    kind: 'patch',
    title: 'Add alt text to the studio photo',
    rationale: 'The photo shows the studio at work.',
    confidence: 0.9,
    ops: ALT,
    after: applyEditOps(SOURCE, ALT),
    verification: passed,
  },
  ...over,
});
const patchWith = (over: Partial<Extract<BuildInput['result'], { kind: 'patch' }>>) =>
  input({
    result: { ...(input().result as Extract<BuildInput['result'], { kind: 'patch' }>), ...over },
  });

/** git apply, the way the exporter will use the diff. */
function gitApply(path: string, source: string, diff: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'beacon-diff-'));
  writeFileSync(join(dir, path), source);
  writeFileSync(join(dir, 'change.diff'), diff);
  execFileSync('git', ['apply', 'change.diff'], { cwd: dir });
  return readFileSync(join(dir, path), 'utf8');
}

describe('buildProposal', () => {
  it('FR-08: a patch that passed guard and verification is a schema-valid pending proposal', () => {
    const { proposal, status } = buildProposal(input(), { clock, ids });
    expect(status).toBe('pending');
    expect(parseProposal(proposal)).toEqual(proposal);
    expect(proposal).toMatchObject({
      schema_version: '1.0',
      run_id: '11111111-1111-4111-8111-111111111111',
      agent: { name: 'beacon-fixer', version: '3' },
      kind: 'patch',
      title: 'Add alt text to the studio photo',
      rule: { id: 'image-alt', standard_refs: ['WCAG 1.1.1'], impact: 'critical' },
      target: {
        page_url: 'https://example.com/about',
        selector: 'main > img',
        file: 'about.html',
        range: { start_line: 7, end_line: 7 },
      },
      change: { format: 'unified_diff', stats: { files: 1, added: 1, removed: 1 } },
      risk: { level: 'medium', reasons: ['generated_text'], reversible: true },
      confidence: 0.9,
      verification: { violation_resolved: true, new_violations: 0, visual_diff_ratio: 0 },
      evidence: { before_screenshot: null, after_screenshot: null },
      base: { commit_sha: 'abc1234', content_hash: `sha256:${'a'.repeat(64)}` },
      question: null,
      created_at: '2026-11-01T10:00:00.000Z',
      expires_at: '2026-11-08T10:00:00.000Z',
    });
    expect(new Set([proposal.proposal_id, proposal.evidence.agent_trace_id]).size).toBe(2);
  });

  it('the diff is a unified diff that git applies to the source to give exactly the patched file', () => {
    const { proposal } = buildProposal(input(), { clock, ids });
    if (proposal.kind !== 'patch') throw new Error('expected a patch');
    expect(proposal.change.diff).toMatch(/^--- a\/about\.html\n\+\+\+ b\/about\.html\n@@ /);
    expect(gitApply('about.html', SOURCE, proposal.change.diff)).toBe(applyEditOps(SOURCE, ALT));
  });

  it('the diff also applies for edits far apart and a file without a final newline', () => {
    const source = SOURCE.trimEnd().replace('<html lang="en">', '<html>');
    const ops: EditOp[] = [
      { op: 'set_attr', at: at(source, '<html'), name: 'lang', value: 'en' },
      { op: 'set_attr', at: at(source, '<img'), name: 'alt', value: 'Studio' },
    ];
    const after = applyEditOps(source, ops);
    const { proposal } = buildProposal(
      input({
        finding: { ...input().finding, ruleId: 'html-has-lang' },
        file: { ...input().file, source },
        result: {
          ...(input().result as Extract<BuildInput['result'], { kind: 'patch' }>),
          ops,
          after,
        },
      }),
      { clock, ids },
    );
    if (proposal.kind !== 'patch') throw new Error('expected a patch');
    expect(gitApply('about.html', source, proposal.change.diff)).toBe(after);
    expect(proposal.rule.standard_refs).toEqual(['WCAG 3.1.1']);
  });

  it('FR-08: a patch that failed verification is failed_verification, including over the visual cap', () => {
    const newViolation = { ...passed, status: 'failed' as const, newViolations: 1 };
    expect(buildProposal(patchWith({ verification: newViolation }), { clock, ids }).status).toBe(
      'failed_verification',
    );
    const overCap = { ...passed, status: 'failed' as const, visualDiffRatio: 0.4 };
    expect(buildProposal(patchWith({ verification: overCap }), { clock, ids }).status).toBe(
      'failed_verification',
    );
  });

  it('a visible change measured by the verifier raises risk to high', () => {
    const { proposal } = buildProposal(
      patchWith({ verification: { ...passed, visualDiffRatio: 0.05 } }),
      { clock, ids },
    );
    expect(proposal.risk).toEqual({
      level: 'high',
      reasons: ['generated_text', 'visual_change'],
      reversible: true,
    });
    expect(proposal.kind === 'patch' && proposal.verification.visual_diff_ratio).toBe(0.05);
  });

  it('a question is awaiting_input and a decline is declined, with no change or verification', () => {
    const common = {
      title: 'What does the QR code link to?',
      rationale: 'It cannot be read.',
      confidence: 0.3,
    };
    const asked = buildProposal(
      input({
        result: {
          ...common,
          kind: 'needs_input',
          question: { text: 'Where does it lead?', options: [] },
        },
      }),
      { clock, ids },
    );
    expect(asked.status).toBe('awaiting_input');
    expect(asked.proposal).toMatchObject({
      kind: 'needs_input',
      change: null,
      verification: null,
      question: { text: 'Where does it lead?', options: [] },
    });
    const declined = buildProposal(input({ result: { ...common, kind: 'decline' } }), {
      clock,
      ids,
    });
    expect(declined.status).toBe('declined');
    expect(declined.proposal).toMatchObject({ kind: 'decline', change: null, question: null });
  });

  it('fails closed on input the schema rejects, such as an unknown impact', () => {
    const bad = input({ finding: { ...input().finding, impact: 'unknown' } });
    expect(catchError(() => buildProposal(bad, { clock, ids }))).toBeInstanceOf(Error);
  });
});
