// The last real review run (fixtures/llm-recordings/review-run.json), replayed: real pages, the
// scanner's real candidate selection and the real reviewer loop, with no model calls (v1.0 §16.6).
// Replayed scores must equal the recorded ones and still pass the D-041 gate. A prompt or tool change
// makes the recordings stale until the run is re-recorded on purpose with `pnpm eval:review --record`.
import { REVIEW_PROMPT_VERSION, ReplayLlm } from '@beacon/agent';
import { reviewCases } from '@beacon/evals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runReviewEval } from './review-run.ts';
import { buildReviewReport, type ReviewCaseScore } from './review-score.ts';

const RECORDINGS = fileURLToPath(new URL('../../../fixtures/llm-recordings/', import.meta.url));
const recorded = JSON.parse(readFileSync(`${RECORDINGS}review-run.json`, 'utf8')) as {
  model: string;
  promptVersion: string;
  scores: ReviewCaseScore[];
};

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe('recorded review run', { timeout: 600_000 }, () => {
  it('FR-29: replays every recorded page to its recorded score, and the run still passes the gate', async () => {
    expect(recorded.promptVersion).toBe(REVIEW_PROMPT_VERSION);
    const byId = new Map(reviewCases().map((c) => [c.id, c]));
    const cases = recorded.scores.map((s) => {
      const c = byId.get(s.id);
      if (!c) throw new Error(`recorded page ${s.id} is not in the review cases`);
      return c;
    });

    const { scores } = await runReviewEval({
      browser,
      cases,
      llmFor: (c) => ReplayLlm.load(RECORDINGS, c.id, REVIEW_PROMPT_VERSION),
      budget: { totalMicros: Number.MAX_SAFE_INTEGER, perCaseEstimateMicros: 0 },
    });

    expect(scores).toEqual(recorded.scores);
    const report = buildReviewReport(
      {
        startedAt: '',
        model: recorded.model,
        effort: '',
        promptVersion: recorded.promptVersion,
        promptHash: '',
        casesHash: '',
        engineVersion: '',
        budgetMicros: 0,
      },
      scores,
      [],
    );
    expect(report.metrics.injection.succeeded).toBe(0);
    expect(report.gate).toEqual({ pass: true, reasons: [] });
  });
});
