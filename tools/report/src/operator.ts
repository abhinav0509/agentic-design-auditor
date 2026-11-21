// Shared by the operator commands (D-045, D-054): the scan sandbox's egress proxy, live models that
// count their cost, and the agent review behind its eval gate. Same checks for every command.
import { anthropicFromEnv, fixerModel, REVIEW_PROMPT_VERSION, type LlmClient } from '@beacon/agent';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { checkReviewGate, type RecordedReviewRun } from './gate.ts';

const SMOKESCREEN = fileURLToPath(
  new URL('../../../.cache/smokescreen/v0.1.0/smokescreen', import.meta.url),
);

/** Smokescreen with its default policy: public addresses only. Resolves once it accepts connections. */
export async function startProxy(): Promise<{ url: string; stop: () => void }> {
  if (!existsSync(SMOKESCREEN))
    throw new Error('Smokescreen is not installed: run pnpm smokescreen:install');
  const port = await new Promise<number>((done) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: p } = s.address() as net.AddressInfo;
      s.close(() => {
        done(p);
      });
    });
  });
  const proc = spawn(SMOKESCREEN, ['--listen-ip', '127.0.0.1', '--listen-port', String(port)], {
    stdio: 'ignore',
  });
  for (let tries = 0; tries < 50; tries++) {
    const up = await new Promise<boolean>((done) => {
      const c = net.connect(port, '127.0.0.1', () => {
        c.end();
        done(true);
      });
      c.on('error', () => {
        done(false);
      });
    });
    if (up) return { url: `http://127.0.0.1:${String(port)}`, stop: () => proc.kill() };
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('Smokescreen did not start');
}

const hasKey = () =>
  Boolean(process.env['ANTHROPIC_API_KEY'] ?? process.env['ANTHROPIC_AUTH_TOKEN']);

/** The configured model, counting what it costs; the total is printed on exit under `label`. */
export function liveModel(label: string): { llm: LlmClient; id: string } {
  if (!hasKey()) throw new Error(`${label} needs ANTHROPIC_API_KEY (in .env.local or the shell)`);
  const model = fixerModel(process.env);
  const live = anthropicFromEnv(model);
  let spent = 0;
  process.on('exit', () => {
    console.log(`${label} cost: $${(spent / 1e6).toFixed(4)} on ${model.id}.`);
  });
  return {
    id: model.id,
    llm: {
      complete: async (r) => {
        const turn = await live.complete(r);
        spent += turn.usage.costMicros;
        return turn;
      },
    },
  };
}

/** The agent review, only behind its eval gate (D-041) and on the model the gate measured. */
export function reviewerBehindGate(): { llm: LlmClient } {
  const recorded = JSON.parse(
    readFileSync(
      new URL('../../../fixtures/llm-recordings/review-run.json', import.meta.url),
      'utf8',
    ),
  ) as RecordedReviewRun;
  const gate = checkReviewGate(recorded, REVIEW_PROMPT_VERSION);
  if (!gate.ok) throw new Error(`agent review is off: ${gate.error}`);
  const model = fixerModel(process.env);
  if (model.id !== gate.model)
    throw new Error(
      `agent review is off: the gate measured ${gate.model}, the configured model is ${model.id}`,
    );
  return { llm: liveModel('Agent review').llm };
}
