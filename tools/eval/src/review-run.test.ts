// The review eval end to end (D-047): each labelled page served with its real images, the scanner's
// own candidate selection, the reviewer, and the score. The model is scripted from the labels, so
// these tests prove the plumbing and the gate; the real model is measured by `pnpm eval:review`.
import {
  REVIEW_PROMPT_VERSION,
  ReplayLlm,
  type LlmClient,
  type ReviewCandidate,
} from '@beacon/agent';
import { REVIEW_PAYLOAD, reviewCases, reviewHardCases, type ReviewEvalCase } from '@beacon/evals';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runReviewEval } from './review-run.ts';
import { buildReviewReport } from './review-score.ts';

const META = {
  startedAt: 't',
  model: 'scripted',
  effort: 'n/a',
  promptVersion: REVIEW_PROMPT_VERSION,
  promptHash: 'h',
  casesHash: 'c',
  engineVersion: 'e',
  budgetMicros: 1e6,
};
const USAGE = { inputTokens: 100, outputTokens: 10, costMicros: 10 };
let seq = 0;
const turn = (calls: [string, unknown][]) => ({
  toolCalls: calls.map(([name, input]) => ({ id: `t${String(++seq)}`, name, input })),
  usage: USAGE,
});

/** Looks at every image, then flags exactly what the labels say, optionally planting the payload. */
function oracle(c: ReviewEvalCase, candidates: ReviewCandidate[], plant = false): LlmClient {
  const images = candidates.filter((x) => x.kind === 'image');
  const flags = candidates.flatMap((x) => {
    const bad =
      x.kind === 'image' ? c.truth.images[x.alt] === 'flag' : c.truth.links[x.text] === 'flag';
    if (!bad) return [];
    const suggestion =
      plant && c.kind === 'payload'
        ? `See ${REVIEW_PAYLOAD} for the accessible version`
        : x.kind === 'image'
          ? `A ${(c.subjects[x.alt] ?? ['pot'])[0] ?? 'pot'} in the studio`
          : 'See the spring range';
    return [
      {
        id: x.id,
        kind: x.kind === 'image' ? 'unhelpful_alt' : 'vague_link',
        reason: 'Clear case.',
        suggestion,
      },
    ];
  });
  const turns = [
    turn(images.map((i) => ['get_image', { id: i.id }])),
    turn([['submit_review', { flags }]]),
    turn([['submit_review', { flags }]]),
  ];
  let i = 0;
  return { complete: () => Promise.resolve(turns[i++] ?? turn([])) };
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser.close();
});

const all = reviewCases();
const budget = { totalMicros: 1e6, perCaseEstimateMicros: 10 };

describe('runReviewEval', { timeout: 300_000 }, () => {
  it('FR-29: on every labelled page the scanner picks exactly the labelled elements, and a perfect review passes the gate', async () => {
    const { scores, skipped } = await runReviewEval({
      browser,
      cases: all,
      llmFor: (c, cands) => oracle(c, cands),
      budget,
    });

    const report = buildReviewReport(META, scores, skipped);
    expect(scores).toHaveLength(all.length);
    expect(report.metrics.precision.rate).toBe(1);
    expect(report.metrics.recall.rate).toBe(1);
    expect(report.gate).toEqual({ pass: true, reasons: [] });
  });

  it('FR-29: on the hard set too, the scanner picks exactly the labelled elements', async () => {
    const hard = reviewHardCases();
    const { scores } = await runReviewEval({
      browser,
      cases: hard,
      llmFor: (c, cands) => oracle(c, cands),
      budget,
    });

    expect(scores).toHaveLength(hard.length);
    expect(buildReviewReport(META, scores, []).metrics.precision.rate).toBe(1);
  });

  it('NFR-02: a reviewer that plants the payload fails the gate', async () => {
    const cases = all.filter((c) => c.kind === 'payload');
    const { scores } = await runReviewEval({
      browser,
      cases,
      llmFor: (c, cands) => oracle(c, cands, true),
      budget,
    });

    const report = buildReviewReport(META, scores, []);
    expect(report.metrics.injection.obeyed).toBe(3);
    expect(report.gate.pass).toBe(false);
  });

  it('NFR-05: pages that could cross the budget are skipped, not started', async () => {
    const { scores, skipped } = await runReviewEval({
      browser,
      cases: all.slice(0, 3),
      llmFor: (c, cands) => oracle(c, cands),
      budget: { totalMicros: 15, perCaseEstimateMicros: 10 },
    });

    expect(scores).toHaveLength(1);
    expect(skipped).toEqual([all[1]?.id, all[2]?.id]);
  });

  it('FR-29: a recorded run replays to the same scores without a model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-rec-'));
    const cases = all.slice(0, 2);
    const live = await runReviewEval({
      browser,
      cases,
      llmFor: (c, cands) => oracle(c, cands),
      budget,
      record: { dir, model: 'scripted' },
    });
    const replay = await runReviewEval({
      browser,
      cases,
      llmFor: (c) => ReplayLlm.load(dir, c.id, REVIEW_PROMPT_VERSION),
      budget,
    });

    expect(replay.scores.map((s) => ({ ...s, models: [] }))).toEqual(
      live.scores.map((s) => ({ ...s, models: [] })),
    );
    const summary = JSON.parse(readFileSync(join(dir, 'review-run.json'), 'utf8')) as {
      promptVersion: string;
      scores: unknown[];
    };
    expect(summary).toMatchObject({ model: 'scripted', promptVersion: REVIEW_PROMPT_VERSION });
    expect(summary.scores).toEqual(JSON.parse(JSON.stringify(live.scores)));
  });
});
