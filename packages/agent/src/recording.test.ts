// Recorded responses (v1.0 §16.6): record real model turns once per scenario, replay them in tests.
// A changed prompt makes a recording stale, and the test fails until it is re-recorded on purpose.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runFixer } from './fixer.ts';
import type { LlmRequest } from './llm.ts';
import { PROMPT_VERSION } from './prompt.ts';
import { recordingPath, RecordingLlm, ReplayLlm } from './recording.ts';
import {
  aJob,
  FakeLlm,
  fakeTools,
  PLANTED,
  textOnly,
  toolUse,
  validDraft,
} from './test-helpers.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'beacon-rec-'));
const script = () => [
  toolUse(['read_file', { path: 'about.html' }]),
  toolUse(['submit_proposal', validDraft()]),
];

async function record(scenario: string, into: string) {
  const live = new FakeLlm(script());
  const recorder = new RecordingLlm(live, { scenario, model: 'claude-opus-5-5' });
  const result = await runFixer({ llm: recorder, job: aJob(), tools: fakeTools() });
  recorder.save(into);
  return { live, result };
}

describe('recordings', () => {
  it('names the file after the scenario and the prompt version', () => {
    expect(recordingPath('/rec', 'image-alt-basic')).toBe(
      `/rec/image-alt-basic.prompt-v${PROMPT_VERSION}.json`,
    );
  });

  it('replays a recorded run without calling the model, with the same result', async () => {
    const into = dir();
    const { result } = await record('basic', into);
    const replay = ReplayLlm.load(into, 'basic');
    const again = await runFixer({ llm: replay, job: aJob(), tools: fakeTools() });
    expect(again).toEqual(result);
    expect(replay.remaining()).toBe(0);
  });

  it('stores the model and prompt version with the turns', async () => {
    const into = dir();
    await record('meta', into);
    const file = JSON.parse(readFileSync(recordingPath(into, 'meta'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(file).toMatchObject({
      scenario: 'meta',
      model: 'claude-opus-5-5',
      promptVersion: PROMPT_VERSION,
    });
    expect(file.turns).toHaveLength(2);
  });

  it('a changed request makes the recording stale, naming the scenario and the step', async () => {
    const into = dir();
    await record('stale', into);
    const replay = ReplayLlm.load(into, 'stale');
    const changed = (r: LlmRequest): LlmRequest => ({ ...r, system: `${r.system} (edited)` });
    const llm = { complete: (r: LlmRequest) => replay.complete(changed(r)) };
    await expect(llm.complete({ system: 'x', messages: [], tools: [] })).rejects.toThrow(
      /stale.*stale.*step 1.*re-record/i,
    );
  });

  it('asking for more turns than were recorded fails', async () => {
    const into = dir();
    const live = new FakeLlm([textOnly('hello')]);
    const recorder = new RecordingLlm(live, { scenario: 'short', model: 'claude-opus-5-5' });
    const req: LlmRequest = { system: 's', messages: [{ role: 'user', content: 'u' }], tools: [] };
    await recorder.complete(req);
    recorder.save(into);
    const replay = ReplayLlm.load(into, 'short');
    await replay.complete(req);
    await expect(replay.complete(req)).rejects.toThrow(/only 1 recorded turn/);
  });

  it('a missing recording says how to record it', () => {
    expect(() => ReplayLlm.load(dir(), 'never')).toThrow(/no recording.*never.*prompt v/i);
  });

  it('NFR-07: secrets are scrubbed from a recording before it is written', async () => {
    const into = dir();
    const { secret, line } = PLANTED[0] ?? { secret: '', line: '' };
    const live = new FakeLlm([textOnly(`I saw ${line}`)]);
    const recorder = new RecordingLlm(live, { scenario: 'secret', model: 'claude-opus-5-5' });
    await recorder.complete({
      system: 's',
      messages: [{ role: 'user', content: line }],
      tools: [],
    });
    recorder.save(into);
    expect(readFileSync(recordingPath(into, 'secret'), 'utf8')).not.toContain(secret);
  });
});
