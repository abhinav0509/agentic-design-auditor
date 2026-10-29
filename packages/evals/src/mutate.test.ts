// Deterministic mutations (v1.0 §15.1): each injects exactly one known violation, so ground truth is
// known by construction. Mutations are the inverse of a fix: they only remove allowed attributes.
import { createHash } from 'node:crypto';
import { guard } from '@beacon/core';
import { describe, expect, it } from 'vitest';
import { loadCleanPages } from './corpus.ts';
import { mutate, RULES } from './mutate.ts';
import { findViolations } from './oracle.ts';

const pages = loadCleanPages();
const page = (id: string) => {
  const p = pages.find((x) => x.id === id);
  if (!p) throw new Error(`no clean page ${id}`);
  return p.html;
};
const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

describe('mutate', () => {
  const cases = pages.flatMap((p) => RULES.map((rule) => [p.id, rule] as const));

  it.each(cases)('%s / %s injects exactly the violation it reports', (id, rule) => {
    const result = mutate(page(id), rule, 1);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(findViolations(result.html)).toEqual([
      { rule, selector: result.selector, line: result.line },
    ]);
  });

  it.each(cases)('%s / %s only removes attributes a fix for that rule may set', (id, rule) => {
    const result = mutate(page(id), rule, 1);
    if (!result) throw new Error('no mutation');
    // Read backwards: the clean page is a valid fix of the mutated one.
    const check = guard({
      ruleId: rule,
      baseHash: sha(result.html),
      files: [{ path: `${id}.html`, before: result.html, after: page(id) }],
    });
    expect(check).toEqual({ ok: true, reasons: [] });
  });

  it('is deterministic for a given seed', () => {
    expect(mutate(page('gallery'), 'image-alt', 7)).toEqual(
      mutate(page('gallery'), 'image-alt', 7),
    );
  });

  it('different seeds can pick different targets', () => {
    const picked = new Set(
      Array.from({ length: 20 }, (_, seed) => mutate(page('gallery'), 'image-alt', seed)?.selector),
    );
    expect(picked.size).toBeGreaterThan(1);
  });

  it('removes every attribute-based label of the chosen control, never a wrapping label', () => {
    // pricing has a wrapped <select> and an aria-label input; only the input is a candidate.
    for (let seed = 0; seed < 10; seed++) {
      expect(mutate(page('pricing'), 'label', seed)?.selector).toBe(
        'html > body > main > form > input:nth-of-type(1)',
      );
    }
  });

  it('returns null when the page has nothing to mutate for the rule', () => {
    const noImages = '<!doctype html>\n<html lang="en">\n<body>\n<p>x</p>\n</body>\n</html>\n';
    expect(mutate(noImages, 'image-alt', 1)).toBeNull();
    expect(mutate(noImages, 'label', 1)).toBeNull();
    expect(mutate(noImages.replace(' lang="en"', ''), 'html-has-lang', 1)).toBeNull();
  });
});
