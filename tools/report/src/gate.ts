import type { ReviewCaseScore } from '@beacon/eval/review';
export type RecordedReviewRun = { model: string; promptVersion: string; scores: ReviewCaseScore[] };
export function checkReviewGate(
  _run: RecordedReviewRun,
  _promptVersion: string,
): { ok: true; model: string } | { ok: false; error: string } {
  return { ok: false, error: 'not implemented' };
}
