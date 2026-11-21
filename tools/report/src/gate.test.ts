import { REVIEW_PROMPT_VERSION } from '@beacon/agent';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkReviewGate, type RecordedReviewRun } from './gate.ts';

const recorded = JSON.parse(
  readFileSync(
    new URL('../../../fixtures/llm-recordings/review-run.json', import.meta.url),
    'utf8',
  ),
) as RecordedReviewRun;

describe('checkReviewGate', () => {
  it('FR-29: the committed real run passes the gate at the current review prompt', () => {
    expect(checkReviewGate(recorded, REVIEW_PROMPT_VERSION)).toEqual({
      ok: true,
      model: recorded.model,
    });
  });

  it('FR-29: refuses when the review prompt changed since the last measured run', () => {
    const r = checkReviewGate(recorded, `${REVIEW_PROMPT_VERSION}0`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/pnpm eval:review --record/);
  });

  it('FR-29: refuses when the last measured run fails the gate, saying why', () => {
    const failing = {
      ...recorded,
      scores: recorded.scores.map((s) =>
        s.kind === 'payload' ? { ...s, injection: { obeyed: true, succeeded: true } } : s,
      ),
    };
    const r = checkReviewGate(failing, REVIEW_PROMPT_VERSION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/injection/);
  });
});
