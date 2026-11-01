// The eval report (addendum F.7): every rate with a 95% Wilson interval, plus the run identity
// (model, prompt, corpus, engine, judge) so two runs can be compared.
import type { CaseScore } from './score.ts';
import { wilson, type Rate } from './stats.ts';

export type RunMeta = {
  startedAt: string;
  model: string;
  effort: string;
  promptVersion: string;
  promptHash: string;
  corpusHash: string;
  engineVersion: string;
  judgeVersion: string | null;
  budgetMicros: number;
};

export function buildReport(meta: RunMeta, scores: CaseScore[], skipped: string[]) {
  const attempted = scores.filter((s) => s.kind === 'fix' && s.attempted);
  const injections = scores.filter((s) => s.kind === 'injection');
  const total = scores.reduce((sum, s) => sum + s.costMicros, 0);
  return {
    meta,
    metrics: {
      validity: wilson(attempted.filter((s) => s.valid).length, attempted.length),
      effectiveness: wilson(attempted.filter((s) => s.effective).length, attempted.length),
      injection: {
        successes: injections.filter((s) => s.injectionSucceeded).length,
        n: injections.length,
        obeyedButBlocked: injections.filter((s) => s.obeyedButBlocked).length,
      },
    },
    restraint: {
      needs_input: scores.filter((s) => s.outcome === 'needs_input').length,
      decline: scores.filter((s) => s.outcome === 'decline').length,
    },
    cost: { totalMicros: total, meanPerCaseMicros: scores.length ? total / scores.length : 0 },
    servedBy: [...new Set(scores.flatMap((s) => s.models))].sort(),
    skipped,
    cases: scores,
  };
}
export type Report = ReturnType<typeof buildReport>;

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const rate = (r: Rate) =>
  `${String(r.k)}/${String(r.n)} = ${pct(r.rate)} (95% CI ${pct(r.low)} to ${pct(r.high)})`;
const usd = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;

export function renderMarkdown(r: Report): string {
  const m = r.meta;
  const outcomes = new Map<string, number>();
  for (const s of r.cases) outcomes.set(s.outcome, (outcomes.get(s.outcome) ?? 0) + 1);
  return `# Eval report: ${m.model} (${m.effort})

Started ${m.startedAt}. Engine ${m.engineVersion}, prompt v${m.promptVersion} (${m.promptHash.slice(0, 12)}), corpus ${m.corpusHash.slice(0, 12)}, judge ${m.judgeVersion ?? 'none'}.

| Metric | Result |
| --- | --- |
| Validity (attempted fixes that passed schema and guard) | ${rate(r.metrics.validity)} |
| Effectiveness (violation gone on re-scan, nothing new) | ${rate(r.metrics.effectiveness)} |
| Successful injections | ${String(r.metrics.injection.successes)}/${String(r.metrics.injection.n)} (the model obeyed but the guard blocked: ${String(r.metrics.injection.obeyedButBlocked)}) |
| Asked a question / declined | ${String(r.restraint.needs_input)} / ${String(r.restraint.decline)} |
| Cost | ${usd(r.cost.totalMicros)} total, ${usd(r.cost.meanPerCaseMicros)} per case (budget ${usd(m.budgetMicros)}) |
| Served by | ${r.servedBy.join(', ') || 'n/a'} |
| Skipped (budget) | ${r.skipped.length ? r.skipped.join(', ') : 'none'} |

## Outcomes

${[...outcomes].map(([k, v]) => `- ${k}: ${String(v)}`).join('\n')}

## Cases

| Case | Kind | Outcome | Valid | Effective | Steps | Cost |
| --- | --- | --- | --- | --- | --- | --- |
${r.cases
  .map(
    (s) =>
      `| ${s.id} | ${s.kind} | ${s.outcome} | ${String(s.valid ?? '')} | ${String(s.effective ?? '')} | ${String(s.steps)} | ${usd(s.costMicros)} |`,
  )
  .join('\n')}
`;
}
