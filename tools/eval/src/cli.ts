// `pnpm eval [--record | --replay] [--limit N]`: the eval against the configured real model (D-027),
// or against the recordings (no calls, no cost). Refuses to start over budget. The API key comes from
// the shell (ANTHROPIC_API_KEY); it is never read here.
import { anthropicFromEnv, fixerModel, PROMPT_VERSION, promptHash, ReplayLlm } from '@beacon/agent';
import { buildCorpus, loadCleanPages, loadHardCases } from '@beacon/evals';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { checkBudget, estimateCaseMicros } from './budget.ts';
import { buildReport, renderMarkdown } from './report.ts';
import { evalCases, runEval } from './run.ts';

const root = new URL('../../../', import.meta.url);
const { values: args } = parseArgs({
  options: {
    record: { type: 'boolean', default: false },
    replay: { type: 'boolean', default: false },
    limit: { type: 'string' },
  },
});

const model = fixerModel(process.env);
const budgetMicros = Number(process.env.BEACON_EVAL_BUDGET_USD ?? '5') * 1e6;
let cases = evalCases(buildCorpus(loadCleanPages(), 42), loadHardCases());
if (args.limit) cases = cases.slice(0, Number(args.limit));
const perCase = estimateCaseMicros(model);
checkBudget(cases.length, perCase, budgetMicros);
const recordings = new URL('fixtures/llm-recordings/', root).pathname;
if (args.record && args.replay) throw new Error('--record and --replay cannot be combined');
if (!args.replay && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN)
  throw new Error('no API credentials: run `export ANTHROPIC_API_KEY=...` in your shell first');

const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const engineVersion = `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') ? '-dirty' : ''}`;
const startedAt = new Date().toISOString();
console.log(
  `eval: ${String(cases.length)} cases on ${model.id} (${model.effort}), estimate $${((cases.length * perCase) / 1e6).toFixed(2)}, budget $${(budgetMicros / 1e6).toFixed(2)}`,
);

const llm = args.replay ? undefined : anthropicFromEnv(model);
const browser = await chromium.launch();
try {
  const { scores, skipped } = await runEval({
    browser,
    cases,
    llmFor: (c) => llm ?? ReplayLlm.load(recordings, c.id),
    budget: { totalMicros: budgetMicros, perCaseEstimateMicros: perCase },
    ...(args.record ? { record: { dir: recordings, model: model.id } } : {}),
    onCase: (s) => {
      console.log(
        `${s.id}: ${s.outcome} ($${(s.costMicros / 1e6).toFixed(4)}, ${String(s.steps)} steps)`,
      );
    },
  });
  const report = buildReport(
    {
      startedAt,
      model: model.id,
      effort: model.effort,
      promptVersion: PROMPT_VERSION,
      promptHash: promptHash(),
      corpusHash: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
      engineVersion,
      judgeVersion: null,
      budgetMicros,
    },
    scores,
    skipped,
  );
  const dir = new URL('reports/evals/', root);
  mkdirSync(dir, { recursive: true });
  const name = `${startedAt.replace(/[:.]/g, '-')}-${model.id}${args.replay ? '-replay' : ''}`;
  writeFileSync(new URL(`${name}.json`, dir), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(new URL(`${name}.md`, dir), renderMarkdown(report));
  console.log(`\nreport: reports/evals/${name}.md`);
} finally {
  await browser.close();
}
