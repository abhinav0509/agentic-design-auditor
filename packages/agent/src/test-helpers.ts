// Test doubles and builders for the fixer (D-015: helpers live next to their package until a second
// package needs them). Not imported by production code.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FixerJob, FixerTools } from './fixer.ts';
import type { LlmClient, LlmRequest, LlmTurn, ToolCall } from './llm.ts';

/** A scripted LlmClient: returns the turns in order and records a deep copy of every request. */
export class FakeLlm implements LlmClient {
  readonly calls: LlmRequest[] = [];
  private next = 0;
  private readonly turns: (LlmTurn | Error)[];

  constructor(turns: (LlmTurn | Error)[]) {
    this.turns = turns;
  }

  complete(request: LlmRequest): Promise<LlmTurn> {
    this.calls.push(structuredClone(request));
    const turn = this.turns[this.next++];
    if (turn === undefined) return Promise.reject(new Error('FakeLlm: script exhausted'));
    return turn instanceof Error ? Promise.reject(turn) : Promise.resolve(turn);
  }
}

let callSeq = 0;
const USAGE = { inputTokens: 100, outputTokens: 20, costMicros: 50 };

/** One assistant turn that calls the given tools. */
export const toolUse = (...calls: [name: string, input: unknown][]): LlmTurn => ({
  toolCalls: calls.map(([name, input]): ToolCall => ({
    id: `call_${String(++callSeq)}`,
    name,
    input,
  })),
  usage: USAGE,
});

export const textOnly = (text: string): LlmTurn => ({ toolCalls: [], text, usage: USAGE });

export const SOURCE = `<!doctype html>
<html lang="en">
<head><title>About</title></head>
<body>
<main>
<img src="team.jpg">
</main>
</body>
</html>
`;
export const IMG_AT = SOURCE.indexOf('<img');

export function aJob(overrides: { pageText?: string } = {}): FixerJob {
  return {
    finding: {
      ruleId: 'image-alt',
      impact: 'critical',
      selector: 'main > img',
      snippet: '<img src="team.jpg">',
      pageUrl: 'https://example.com/about',
      pageText: overrides.pageText ?? 'Meet the team behind Beacon.',
      at: IMG_AT,
    },
    file: {
      path: 'about.html',
      source: SOURCE,
      baseHash: `sha256:${createHash('sha256').update(SOURCE).digest('hex')}`,
    },
    context: {
      pageUrl: 'https://example.com/about',
      insideForm: false,
      decorativeAgreed: false,
      visualDiffRatio: 0,
    },
  };
}

export const validDraft = (value = 'The Beacon team at the 2026 offsite') => ({
  kind: 'patch',
  title: 'Add alt text to the team photo',
  rationale: 'The image is informative and has no text alternative.',
  confidence: 0.9,
  ops: [{ op: 'set_attr', at: IMG_AT, name: 'alt', value }],
});

/** Tools over the fixture file; the DOM snippet is page content, so it is attacker-controlled. */
export function fakeTools(overrides: Partial<FixerTools> = {}): FixerTools {
  return {
    readFile: (path) =>
      path === 'about.html'
        ? Promise.resolve(SOURCE)
        : Promise.reject(new Error(`no file ${path}`)),
    searchSource: () => Promise.resolve('about.html:6: <img src="team.jpg">'),
    getDomSnippet: () => Promise.resolve('<main><img src="team.jpg"></main>'),
    getImage: () => Promise.resolve({ mediaType: 'image/png', data: 'iVBORw0KGgo=' }),
    ...overrides,
  };
}

/**
 * 50 fake secrets in gitleaks rule formats, each inside a realistic line (fixtures/secrets). Stored
 * reversed so no secret scanner (GitHub push protection, gitleaks in CI) sees a token in the repo.
 */
export const PLANTED = (
  JSON.parse(
    readFileSync(new URL('../../../fixtures/secrets/planted.json', import.meta.url), 'utf8'),
  ) as { rule: string; template: string; reversed: string }[]
).map(({ rule, template, reversed }) => {
  const secret = [...reversed].reverse().join('');
  return { rule, secret, line: template.replace('{secret}', secret) };
});
