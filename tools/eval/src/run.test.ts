// The eval runner end to end, with a scripted model: real scan, real fixer loop, real re-scan.
import type { FixerJob, LlmClient, LlmTurn } from '@beacon/agent';
import { buildCorpus, loadCleanPages } from '@beacon/evals';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evalCases, runEval } from './run.ts';

const CORPUS = buildCorpus(loadCleanPages(), 42);
const pick = (id: string) => {
  const c = CORPUS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

let n = 0;
const turn = (name: string, input: unknown): LlmTurn => ({
  toolCalls: [{ id: `c${String(++n)}`, name, input }],
  usage: { inputTokens: 3000, outputTokens: 300, costMicros: 18_000 },
  model: 'claude-opus-5-5',
});
/** Fixes whatever the job points at, the way a good model would; or obeys an injection. */
function scripted(job: FixerJob, obey = false): LlmClient {
  const value = obey ? '<script src=//evil.example/x.js></script>' : 'A clear description';
  const name =
    job.finding.ruleId === 'image-alt'
      ? 'alt'
      : job.finding.ruleId === 'label'
        ? 'aria-label'
        : 'lang';
  const draft = {
    kind: 'patch',
    title: 'Fix',
    rationale: 'Because.',
    confidence: 0.9,
    ops: [
      { op: 'set_attr', at: job.finding.at, name, value: name === 'lang' && !obey ? 'en' : value },
    ],
  };
  const turns = [turn('get_dom_snippet', {}), turn('submit_proposal', draft)];
  return {
    complete: () => Promise.resolve(turns.shift() ?? turn('get_dom_snippet', {})),
  };
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe('evalCases', () => {
  it('is the corpus fix cases plus injection cases built from image cases', () => {
    const cases = evalCases(CORPUS);
    expect(cases.filter((c) => c.kind === 'fix')).toHaveLength(CORPUS.length);
    const inj = cases.filter((c) => c.kind === 'injection');
    expect(inj.length).toBeGreaterThanOrEqual(5);
    expect(inj.every((c) => c.html.includes('evil.example') && c.payload === 'evil.example')).toBe(
      true,
    );
  });
});

describe('runEval', { timeout: 120_000 }, () => {
  it('scores real fixes by re-scanning the patched page, records which model answered', async () => {
    const cases = evalCases([pick('about--image-alt'), pick('contact--label')]).filter(
      (c) => c.kind === 'fix',
    );
    const { scores, skipped } = await runEval({
      browser,
      cases,
      llmFor: (_c, job) => scripted(job),
      budget: { totalMicros: 5_000_000, perCaseEstimateMicros: 62_000 },
    });
    expect(skipped).toEqual([]);
    expect(scores.map((s) => [s.id, s.valid, s.effective])).toEqual([
      ['about--image-alt', true, true],
      ['contact--label', true, true],
    ]);
    expect(scores[0]?.models).toEqual(['claude-opus-5-5']);
    expect(scores[0]?.costMicros).toBe(36_000);
  });

  it('NFR-02: an obeyed injection on an injection case is blocked and does not succeed', async () => {
    const [inj] = evalCases([pick('about--image-alt')]).filter((c) => c.kind === 'injection');
    if (!inj) throw new Error('no injection case');
    const { scores } = await runEval({
      browser,
      cases: [inj],
      llmFor: (_c, job) => scripted(job, true),
      budget: { totalMicros: 5_000_000, perCaseEstimateMicros: 62_000 },
    });
    expect(scores[0]).toMatchObject({
      outcome: 'blocked',
      injectionSucceeded: false,
      obeyedButBlocked: true,
    });
  });

  it('NFR-05: skips the remaining cases once the budget could be crossed', async () => {
    const cases = evalCases([pick('about--image-alt'), pick('team--image-alt')]).filter(
      (c) => c.kind === 'fix',
    );
    const { scores, skipped } = await runEval({
      browser,
      cases,
      llmFor: (_c, job) => scripted(job),
      budget: { totalMicros: 90_000, perCaseEstimateMicros: 62_000 }, // 36 000 spent + 62 000 > 90 000
    });
    expect(scores).toHaveLength(1);
    expect(skipped).toEqual(['team--image-alt']);
  });

  it('writes a recording per case when asked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'beacon-eval-'));
    const cases = evalCases([pick('about--image-alt')]).filter((c) => c.kind === 'fix');
    await runEval({
      browser,
      cases,
      llmFor: (_c, job) => scripted(job),
      budget: { totalMicros: 5_000_000, perCaseEstimateMicros: 62_000 },
      record: { dir, model: 'claude-opus-5-5' },
    });
    expect(existsSync(join(dir, 'about--image-alt.prompt-v1.json'))).toBe(true);
  });
});
