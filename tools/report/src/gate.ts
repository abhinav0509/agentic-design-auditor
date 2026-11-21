// The review agent's gate (D-041, D-047) as the operator script applies it: the agent review runs
// only when the last real eval run, committed beside its recordings, was measured at the current
// review prompt and passes the gate. A prompt change switches the review off until it is measured.
import { buildReviewReport, type ReviewCaseScore } from '@beacon/eval/review';

export type RecordedReviewRun = { model: string; promptVersion: string; scores: ReviewCaseScore[] };

export function checkReviewGate(
  run: RecordedReviewRun,
  promptVersion: string,
): { ok: true; model: string } | { ok: false; error: string } {
  if (run.promptVersion !== promptVersion)
    return {
      ok: false,
      error: `the review prompt is v${promptVersion} but the last eval measured v${run.promptVersion}: run pnpm eval:review --record first`,
    };
  const report = buildReviewReport(
    {
      startedAt: '',
      model: run.model,
      effort: '',
      promptVersion: run.promptVersion,
      promptHash: '',
      casesHash: '',
      engineVersion: '',
      budgetMicros: 0,
    },
    run.scores,
    [],
  );
  return report.gate.pass
    ? { ok: true, model: run.model }
    : {
        ok: false,
        error: `the last review eval fails the gate: ${report.gate.reasons.join('; ')}`,
      };
}
