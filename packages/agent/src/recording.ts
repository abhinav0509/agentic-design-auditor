// Recorded model turns (v1.0 §16.6, D-026): record a real run once per scenario, replay it in tests.
// Each turn is stored with a hash of the request that produced it, so a changed prompt, tool or
// input makes the recording stale instead of silently replaying answers to a different question.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmClient, LlmRequest, LlmTurn } from './llm.ts';
import { PROMPT_VERSION } from './prompt.ts';
import { scrubSecrets } from './scrub.ts';

type Recording = {
  scenario: string;
  model: string;
  promptVersion: string;
  turns: { requestHash: string; turn: LlmTurn }[];
};

export const recordingPath = (dir: string, scenario: string) =>
  join(dir, `${scenario}.prompt-v${PROMPT_VERSION}.json`);

// Scrubbed before hashing, so recording (raw turns) and replay (scrubbed turns) hash the same.
const hashRequest = (r: LlmRequest) =>
  createHash('sha256')
    .update(scrubSecrets(JSON.stringify(r)))
    .digest('hex');

export class RecordingLlm implements LlmClient {
  private readonly inner: LlmClient;
  private readonly recording: Recording;

  constructor(inner: LlmClient, meta: { scenario: string; model: string }) {
    this.inner = inner;
    this.recording = { ...meta, promptVersion: PROMPT_VERSION, turns: [] };
  }

  async complete(request: LlmRequest): Promise<LlmTurn> {
    const turn = await this.inner.complete(request);
    this.recording.turns.push({ requestHash: hashRequest(request), turn });
    return turn;
  }

  /** NFR-07: the file is scrubbed of secrets before it is written. */
  save(dir: string): void {
    mkdirSync(dir, { recursive: true });
    const json = scrubSecrets(JSON.stringify(this.recording, null, 2));
    writeFileSync(recordingPath(dir, this.recording.scenario), `${json}\n`);
  }
}

export class ReplayLlm implements LlmClient {
  private readonly recording: Recording;
  private next = 0;

  private constructor(recording: Recording) {
    this.recording = recording;
  }

  static load(dir: string, scenario: string): ReplayLlm {
    const path = recordingPath(dir, scenario);
    if (!existsSync(path))
      throw new Error(
        `no recording for ${scenario} at prompt v${PROMPT_VERSION} (${path}); record it with a real run`,
      );
    return new ReplayLlm(JSON.parse(readFileSync(path, 'utf8')) as Recording);
  }

  complete(request: LlmRequest): Promise<LlmTurn> {
    const { scenario, turns } = this.recording;
    const step = this.next + 1;
    const recorded = turns[this.next++];
    if (!recorded)
      return Promise.reject(
        new Error(
          `${scenario}: only ${String(turns.length)} recorded turn(s), step ${String(step)} asked for more`,
        ),
      );
    if (recorded.requestHash !== hashRequest(request))
      return Promise.reject(
        new Error(
          `stale recording ${scenario}: the request at step ${String(step)} changed since it was recorded; re-record it`,
        ),
      );
    return Promise.resolve(recorded.turn);
  }

  remaining(): number {
    return this.recording.turns.length - this.next;
  }
}
