// The review eval runner (D-041, D-047): for each labelled page, serve it with its real corpus
// images, let the scanner pick the candidates exactly as in production, run the reviewer on them and
// score every candidate against its label. Pages run one at a time so the budget sees each cost
// before the next page starts.
import {
  RecordingLlm,
  REVIEW_PROMPT_VERSION,
  runReviewer,
  type LlmClient,
  type LlmRequest,
  type ReviewCandidate,
} from '@beacon/agent';
import { imageFor, type ReviewEvalCase } from '@beacon/evals';
import { guardContext, scanPageContent } from '@beacon/scanner';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { Budget } from './budget.ts';
import { scoreReviewCase, type ReviewCaseScore } from './review-score.ts';

const ORIGIN = 'https://corpus.test';
// The pages are served by routing, never fetched; this stands in for a public address for the guard.
const PUBLIC = ['93.184.215.14'];

/** The scanner's candidates for one page, with each image candidate's crop. */
async function candidatesFor(browser: Browser, c: ReviewEvalCase) {
  const url = `${ORIGIN}/${c.id}.html`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    await context.route('**/*', (route) => {
      const requested = route.request().url();
      if (requested === url) return route.fulfill({ contentType: 'text/html', body: c.html });
      const img = imageFor(new URL(requested).pathname);
      return img
        ? route.fulfill({ contentType: img.mediaType, body: Buffer.from(img.data, 'base64') })
        : route.abort();
    });
    await guardContext(context, () => Promise.resolve(PUBLIC));
    const { review } = await scanPageContent(context, url, { review: true });
    return { url, ...review };
  } finally {
    await context.close();
  }
}

/** Fails loudly when selection and labels disagree, so a score never rests on a mislabelled page. */
function checkLabels(c: ReviewEvalCase, candidates: ReviewCandidate[]): void {
  const picked = candidates
    .map((x) => (x.kind === 'image' ? `image:${x.alt}` : `link:${x.text}`))
    .sort();
  const labelled = [
    ...Object.keys(c.truth.images).map((a) => `image:${a}`),
    ...Object.keys(c.truth.links).map((t) => `link:${t}`),
  ].sort();
  if (JSON.stringify(picked) !== JSON.stringify(labelled))
    throw new Error(
      `${c.id}: the scanner picked ${JSON.stringify(picked)} but the labels are ${JSON.stringify(labelled)}`,
    );
}

export async function runReviewEval(input: {
  browser: Browser;
  cases: ReviewEvalCase[];
  llmFor: (c: ReviewEvalCase, candidates: ReviewCandidate[]) => LlmClient;
  budget: { totalMicros: number; perCaseEstimateMicros: number };
  record?: { dir: string; model: string };
  onCase?: (s: ReviewCaseScore) => void;
}): Promise<{ scores: ReviewCaseScore[]; skipped: string[]; spentMicros: number }> {
  const budget = new Budget(input.budget.totalMicros, input.budget.perCaseEstimateMicros);
  const scores: ReviewCaseScore[] = [];
  const skipped: string[] = [];
  for (const c of input.cases) {
    if (!budget.canStart()) {
      skipped.push(c.id);
      continue;
    }
    const { url, candidates, images } = await candidatesFor(input.browser, c);
    checkLabels(c, candidates);

    const inner = input.llmFor(c, candidates);
    const recorder =
      input.record &&
      new RecordingLlm(inner, {
        scenario: c.id,
        model: input.record.model,
        promptVersion: REVIEW_PROMPT_VERSION,
      });
    const models = new Set<string>();
    const attempts: unknown[] = [];
    const llm: LlmClient = {
      complete: async (r: LlmRequest) => {
        const turn = await (recorder ?? inner).complete(r);
        if (turn.model) models.add(turn.model);
        for (const call of turn.toolCalls)
          if (call.name === 'submit_review') attempts.push(call.input);
        return turn;
      },
    };
    const result = await runReviewer({
      llm,
      job: { pageUrl: url, candidates },
      tools: {
        getImage: (id) => {
          const png = images.find((i) => i.id === id)?.png;
          return png
            ? Promise.resolve({ mediaType: 'image/png', data: Buffer.from(png).toString('base64') })
            : Promise.reject(new Error('the image could not be captured'));
        },
      },
    });
    budget.spend(result.usage.costMicros);
    if (recorder && input.record) recorder.save(input.record.dir);
    const score = scoreReviewCase({ c, candidates, result, attempts, models: [...models] });
    scores.push(score);
    input.onCase?.(score);
  }
  // The run's scores beside its recordings, so a replay test can hold real output to them.
  if (input.record)
    writeFileSync(
      join(input.record.dir, 'review-run.json'),
      `${JSON.stringify({ model: input.record.model, promptVersion: REVIEW_PROMPT_VERSION, scores }, null, 2)}\n`,
    );
  return { scores, skipped, spentMicros: budget.spentMicros };
}
