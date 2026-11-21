import type { LlmClient, ReviewCandidate } from '@beacon/agent';
import type { ReviewEvalCase } from '@beacon/evals';
import type { Browser } from 'playwright';
import type { ReviewCaseScore } from './review-score.ts';

export function runReviewEval(_input: {
  browser: Browser;
  cases: ReviewEvalCase[];
  llmFor: (c: ReviewEvalCase, candidates: ReviewCandidate[]) => LlmClient;
  budget: { totalMicros: number; perCaseEstimateMicros: number };
  record?: { dir: string; model: string };
  onCase?: (s: ReviewCaseScore) => void;
}): Promise<{ scores: ReviewCaseScore[]; skipped: string[]; spentMicros: number }> {
  return Promise.reject(new Error('not implemented'));
}
