// No real model calls in unit or integration tests (NFR-11, CLAUDE.md hard rule). Tests use FakeLlm,
// recordings, or AnthropicLlm over an injected fake API; this checks no test file can reach the live
// model: no live client from the environment, no SDK import, no API address.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LIVE = [/\banthropicFromEnv\s*\(/, /from ['"]@anthropic-ai\/sdk['"]/, /api\.anthropic\.com/];
const SELF = 'packages/agent/src/no-live-model.test.ts';

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return testFiles(path);
    return name.endsWith('.test.ts') ? [path] : [];
  });
}

it('NFR-11: no test file can call a real model', () => {
  const files = ['packages', 'apps', 'tools'].flatMap((d) => testFiles(join(ROOT, d)));
  const live = files
    .map((f) => relative(ROOT, f))
    .filter((f) => f !== SELF)
    .filter((f) => LIVE.some((re) => re.test(readFileSync(join(ROOT, f), 'utf8'))));

  expect(files.length).toBeGreaterThan(50);
  expect(live).toEqual([]);
});
