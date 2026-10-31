// Secrets never reach the model (NFR-07, addendum 2.9): the vendored gitleaks rules scrub every
// untrusted text, and secret-bearing files are never read.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSensitivePath, RULES, RULES_PATH, scrubSecrets, toJsRegex } from './scrub.ts';
import { PLANTED, SOURCE } from './test-helpers.ts';

const CORPUS = new URL('../../../fixtures/corpus/clean/', import.meta.url);

describe('scrubSecrets', () => {
  it('uses the vendored gitleaks v8.30.1 rule file, unmodified', () => {
    expect(createHash('sha256').update(readFileSync(RULES_PATH)).digest('hex')).toBe(
      'e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf',
    );
  });

  it('compiles every regex rule in the file (222 rules, one is path-only)', () => {
    expect(RULES).toHaveLength(221);
  });

  it('translates the Go regex syntax the rules use', () => {
    expect('aB').toMatch(toJsRegex('a(?i)b')); // a flag in the middle of the pattern
    expect('AB').toMatch(toJsRegex('(?i)a(?-i:B)'));
    expect('ax').toMatch(toJsRegex('x\\z'));
    expect('x\ny').not.toMatch(toJsRegex('x\\z'));
    expect(toJsRegex('(?P<k>a)').exec('a')?.groups?.k).toBe('a');
    expect('Z9').toMatch(toJsRegex('^[[:alnum:]]+$'));
  });

  it.each(PLANTED)('NFR-07: strips a planted $rule secret', ({ secret, line }) => {
    const out = scrubSecrets(line);
    expect(out).toContain('[REDACTED_SECRET]');
    // no 16-character piece of the secret survives either
    for (let i = 0; i + 16 <= secret.length; i += 1)
      expect(out).not.toContain(secret.slice(i, i + 16));
  });

  it('replaces only the secret and keeps the code around it', () => {
    const planted = PLANTED.find((p) => p.rule === 'github-pat');
    if (!planted) throw new Error('fixture missing github-pat');
    expect(scrubSecrets(planted.line)).toBe(
      planted.line.replace(planted.secret, '[REDACTED_SECRET]'),
    );
  });

  it('leaves ordinary page markup alone, including words like key and password', () => {
    const markup = `<label for="api-key">API key</label>
<input id="api-key" name="password" type="password" autocomplete="current-password">
<input aria-labelledby="password-help-text" id="new-password-field">
<a href="/account/access-tokens">Manage access tokens</a>`;
    expect(scrubSecrets(markup)).toBe(markup);
    expect(scrubSecrets(SOURCE)).toBe(SOURCE);
    for (const f of readdirSync(CORPUS)) {
      const html = readFileSync(new URL(f, CORPUS), 'utf8');
      expect(scrubSecrets(html), f).toBe(html);
    }
  });

  it('follows gitleaks: a match below the rule entropy is not a secret', () => {
    const lowEntropy = `ghp_${'a'.repeat(36)}`;
    expect(scrubSecrets(lowEntropy)).toBe(lowEntropy);
  });
});

describe('isSensitivePath', () => {
  it.each([
    '.env',
    '.env.production',
    'config/.env.local',
    '.envrc',
    'certs/server.pem',
    'certs/Server.PEM',
    'deploy/site.key',
    'home/.ssh/id_rsa',
    'keys/id_ed25519.pub',
  ])('NFR-07: never sends %s to the model', (path) => {
    expect(isSensitivePath(path)).toBe(true);
  });

  it.each(['about.html', 'src/key-handler.ts', 'src/env.ts', 'docs/identity.md', 'keys.html'])(
    'allows %s',
    (path) => {
      expect(isSensitivePath(path)).toBe(false);
    },
  );
});
