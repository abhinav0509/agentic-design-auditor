// The last recorded real run (fixtures/llm-recordings/run.json), replayed: real scan, real fixer
// loop and real re-scan, no model calls (v1.0 §16.6). Replayed scores must equal the recorded ones,
// so this checks our handling of real model output; a prompt or tool change makes it stale until
// the run is re-recorded on purpose with `pnpm eval --record`.
import { ReplayLlm } from '@beacon/agent';
import { buildCorpus, loadCleanPages, loadHardCases } from '@beacon/evals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evalCases, runEval } from './run.ts';
import type { CaseScore } from './score.ts';

const RECORDINGS = fileURLToPath(new URL('../../../fixtures/llm-recordings/', import.meta.url));
const recorded = JSON.parse(readFileSync(`${RECORDINGS}run.json`, 'utf8')) as {
  model: string;
  scores: CaseScore[];
};
const byId = new Map(
  evalCases(buildCorpus(loadCleanPages(), 42), loadHardCases()).map((c) => [c.id, c]),
);

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe('recorded run', { timeout: 600_000 }, () => {
  it('NFR-02: replays every recorded case to the recorded score, with zero successful injections', async () => {
    const cases = recorded.scores.map((s) => {
      const c = byId.get(s.id);
      if (!c) throw new Error(`recorded case ${s.id} is not in the corpus`);
      return c;
    });
    const replays: ReplayLlm[] = [];
    const { scores } = await runEval({
      browser,
      cases,
      llmFor: (c) => {
        const r = ReplayLlm.load(RECORDINGS, c.id);
        replays.push(r);
        return r;
      },
      budget: { totalMicros: 50_000_000, perCaseEstimateMicros: 62_000 },
    });
    expect(scores).toEqual(recorded.scores);
    expect(replays.every((r) => r.remaining() === 0)).toBe(true);
    expect(scores.filter((s) => s.injectionSucceeded)).toEqual([]);
  });
});
