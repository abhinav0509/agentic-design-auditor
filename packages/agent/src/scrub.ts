// Secret scrubbing (NFR-07, addendum 2.9, D-023). Every untrusted text bound for the model passes
// through scrubSecrets, which applies the vendored, pinned gitleaks rule set translated to JS regexes.
import { readFileSync } from 'node:fs';

export const RULES_PATH = new URL('../vendor/gitleaks-v8.30.1/gitleaks.toml', import.meta.url);

/** Above this, scrubbing costs too much (about 38 ms per KB worst case), so the text is not sent. */
export const MAX_UNTRUSTED_CHARS = 32_000;

const REDACTED = '[REDACTED_SECRET]';

type Rule = { id: string; re: RegExp; entropy?: number; secretGroup?: number };

/** Go RE2 syntax used by the rules → JS. A mid-pattern (?i) widens to the whole pattern: it can only redact more. */
export function toJsRegex(go: string): RegExp {
  let src = go
    .replaceAll('(?P<', '(?<')
    .replaceAll('\\z', '$')
    .replaceAll('[[:alnum:]]', '[a-zA-Z0-9]');
  let flags = 'gd';
  for (const f of ['i', 's'])
    if (src.includes(`(?${f})`)) {
      flags += f;
      src = src.replaceAll(`(?${f})`, '');
    }
  return new RegExp(src, flags);
}

// shortcut: line-based reader for the generated file (one key per line, rule fields before any
// sub-table); keywords and allowlists are skipped, which only redacts more. Use a TOML parser if
// the vendored file's format changes.
function loadRules(toml: string): Rule[] {
  const rules: Partial<Rule & { regex: string }>[] = [];
  let current: Partial<Rule & { regex: string }> | undefined;
  for (const line of toml.split('\n')) {
    if (line === '[[rules]]') rules.push((current = {}));
    else if (line.startsWith('[')) current = undefined;
    else if (current) {
      const [, key, value] = /^(id|regex|entropy|secretGroup) = (.*)$/.exec(line) ?? [];
      if (key === 'id' && value) current.id = value.slice(1, -1);
      if (key === 'regex' && value) current.regex = value.slice(3, -3);
      if (key === 'entropy') current.entropy = Number(value);
      if (key === 'secretGroup') current.secretGroup = Number(value);
    }
  }
  return rules.flatMap(({ id, regex, entropy, secretGroup }) =>
    id && regex
      ? [
          {
            id,
            re: toJsRegex(regex),
            ...(entropy === undefined ? {} : { entropy }),
            ...(secretGroup === undefined ? {} : { secretGroup }),
          },
        ]
      : [],
  );
}

export const RULES: readonly Rule[] = loadRules(readFileSync(RULES_PATH, 'utf8'));

function shannon(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

function secretSpans(text: string, spans: [number, number][]): void {
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      // gitleaks: the configured group, else the first non-empty group, else the whole match
      // (unmatched groups are undefined at runtime, whatever the types say)
      const first = m.findIndex((s, i) => i > 0 && Boolean(s));
      const g = rule.secretGroup ?? Math.max(0, first);
      const span = m.indices?.[g];
      const secret = m[g];
      if (!span || !secret) continue;
      if (rule.entropy !== undefined && shannon(secret) <= rule.entropy) continue;
      spans.push(span);
    }
  }
}

/** Replaces every secret gitleaks would report with a marker; the text around it is kept. */
export function scrubSecrets(text: string): string {
  const spans: [number, number][] = [];
  secretSpans(text, spans);
  // Gitleaks rules end a token at a quote, space or line end, so `key</p>` in HTML is missed. A
  // second pass with tag brackets as spaces finds it; same length, so spans map onto the original.
  if (/[<>]/.test(text)) secretSpans(text.replace(/[<>]/g, ' '), spans);
  spans.sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [start, end] of spans) {
    if (end <= at) continue;
    if (start >= at) out += text.slice(at, start) + REDACTED;
    at = end;
  }
  return out + text.slice(at);
}

/** Scrubbed text, or undefined when it is too large to scrub and send. */
export const forModel = (text: string): string | undefined =>
  text.length > MAX_UNTRUSTED_CHARS ? undefined : scrubSecrets(text);

/** Files never sent to the model (addendum 2.9): .env*, *.pem, *.key, id_*. */
export const isSensitivePath = (path: string): boolean =>
  /(?:^|\/)(?:\.env[^/]*|[^/]*\.(?:pem|key)|id_[^/]*)$/i.test(path);
