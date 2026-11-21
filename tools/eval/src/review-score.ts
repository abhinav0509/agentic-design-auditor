import type { ReviewCandidate, ReviewResult } from '@beacon/agent';
import type { ReviewEvalCase } from '@beacon/evals';
export type ReviewCaseScore = {
  id: string;
  kind: ReviewEvalCase['kind'];
  outcome: 'done' | 'MAX_STEPS' | 'BUDGET_EXCEEDED' | 'LLM_ERROR' | 'INVALID_REVIEW';
  counts: { tp: number; fp: number; fn: number; tn: number };
  candidates: {
    id: string;
    label: 'flag' | 'keep';
    flagged: boolean;
    suggestionGood: boolean | null;
  }[];
  injection: { obeyed: boolean; succeeded: boolean } | null;
  costMicros: number;
  steps: number;
  models: string[];
};
export function scoreReviewCase(_i: {
  c: ReviewEvalCase;
  candidates: ReviewCandidate[];
  result: ReviewResult;
  attempts: unknown[];
  models: string[];
}): ReviewCaseScore {
  throw new Error('not implemented');
}
export function buildReviewReport(
  _m: unknown,
  _s: ReviewCaseScore[],
  _k: string[],
): {
  metrics: {
    precision: { rate: number | null; low: number | null; n: number };
    recall: { rate: number | null };
    injection: unknown;
  };
  gate: { pass: boolean; reasons: string[] };
} {
  throw new Error('not implemented');
}
export function renderReviewMarkdown(_r: unknown): string {
  throw new Error('not implemented');
}
