// `pnpm eval:review [--set basic|hard] [--record | --replay] [--limit N]`: the review agent eval (D-047) against the
// configured real model, or against the recordings (no calls, no cost). Refuses to start over
// budget. Prints the D-041 gate verdict; the API key comes from the shell and is never read here.
import {
  anthropicFromEnv,
  fixerModel,
  ReplayLlm,
  REVIEW_PROMPT_VERSION,
  reviewPromptHash,
} from '@beacon/agent';
import { reviewCases, reviewHardCases } from '@beacon/evals';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { checkBudget, estimateReviewPageMicros } from './budget.ts';
import { runReviewEval } from './review-run.ts';
import { buildReviewReport, renderReviewMarkdown } from './review-score.ts';

const root = new URL('../../../', import.meta.url);
const { values: args } = parseArgs({
  options: {
    record: { type: 'boolean', default: false },
    replay: { type: 'boolean', default: false },
    limit: { type: 'string' },
    set: { type: 'string', default: 'basic' },
  },
});
if (args.set !== 'basic' && args.set !== 'hard') throw new Error('--set is basic or hard');
const hard = args.set === 'hard';

const model = fixerModel(process.env);
const budgetMicros = Number(process.env['BEACON_EVAL_BUDGET_USD'] ?? '5') * 1e6;
let cases = hard ? reviewHardCases() : reviewCases();
if (args.limit) cases = cases.slice(0, Number(args.limit));
const perPage = estimateReviewPageMicros(model);
checkBudget(cases.length, perPage, budgetMicros);
const recordings = new URL('fixtures/llm-recordings/', root).pathname;
if (args.record && args.replay) throw new Error('--record and --replay cannot be combined');
if (!args.replay && !process.env['ANTHROPIC_API_KEY'] && !process.env['ANTHROPIC_AUTH_TOKEN'])
  throw new Error('no API credentials: run `export ANTHROPIC_API_KEY=...` in your shell first');

const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const engineVersion = `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') ? '-dirty' : ''}`;
const startedAt = new Date().toISOString();
console.log(
  `eval:review (${args.set}): ${String(cases.length)} pages on ${model.id} (${model.effort}), estimate $${((cases.length * perPage) / 1e6).toFixed(2)}, budget $${(budgetMicros / 1e6).toFixed(2)}`,
);

const llm = args.replay ? undefined : anthropicFromEnv(model);
const browser = await chromium.launch();
try {
  const { scores, skipped } = await runReviewEval({
    browser,
    cases,
    llmFor: (c) => llm ?? ReplayLlm.load(recordings, c.id, REVIEW_PROMPT_VERSION),
    budget: { totalMicros: budgetMicros, perCaseEstimateMicros: perPage },
    ...(args.record
      ? {
          record: {
            dir: recordings,
            model: model.id,
            summary: hard ? 'review-hard-run.json' : 'review-run.json',
          },
        }
      : {}),
    onCase: (s) => {
      const { tp, fp, fn } = s.counts;
      console.log(
        `${s.id}: ${s.outcome}, ${String(tp)} right, ${String(fp)} wrong, ${String(fn)} missed ($${(s.costMicros / 1e6).toFixed(4)}, ${String(s.steps)} steps)`,
      );
    },
  });
  const report = buildReviewReport(
    {
      startedAt,
      model: model.id,
      effort: model.effort,
      promptVersion: REVIEW_PROMPT_VERSION,
      promptHash: reviewPromptHash(),
      casesHash: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
      engineVersion,
      budgetMicros,
    },
    scores,
    skipped,
  );
  const dir = new URL('reports/evals/', root);
  mkdirSync(dir, { recursive: true });
  const name = `${startedAt.replace(/[:.]/g, '-')}-review${hard ? '-hard' : ''}-${model.id}${args.replay ? '-replay' : ''}`;
  writeFileSync(new URL(`${name}.json`, dir), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(new URL(`${name}.md`, dir), renderReviewMarkdown(report));
  console.log(`\ngate: ${report.gate.pass ? 'pass' : `fail (${report.gate.reasons.join('; ')})`}`);
  console.log(`report: reports/evals/${name}.md`);
} finally {
  await browser.close();
}
