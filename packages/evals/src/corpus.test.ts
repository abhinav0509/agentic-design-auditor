// Corpus v0: clean pages × the three MVP rules, each case carrying its ground truth.
import { describe, expect, it } from 'vitest';
import { buildCorpus, loadCleanPages } from './corpus.ts';
import { findViolations } from './oracle.ts';

describe('loadCleanPages', () => {
  it('loads the ten v0 pages, sorted by id', () => {
    const ids = loadCleanPages().map((p) => p.id);
    expect(ids).toHaveLength(10);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('buildCorpus', () => {
  const pages = loadCleanPages();

  it('builds one case per page and rule, with stable ids', () => {
    const corpus = buildCorpus(pages, 42);
    expect(corpus).toHaveLength(30);
    expect(corpus[0]?.id).toBe('about--html-has-lang');
    expect(new Set(corpus.map((c) => c.id)).size).toBe(30);
  });

  it('every case has exactly one violation and it matches the ground truth', () => {
    for (const c of buildCorpus(pages, 42)) {
      expect(findViolations(c.html)).toEqual([
        { rule: c.truth.rule, selector: c.truth.selector, line: c.truth.line },
      ]);
      expect(c.truth).toMatchObject({ case_id: c.id, page: c.page, file: `${c.page}.html` });
    }
  });

  it('is deterministic: the same seed builds the same corpus', () => {
    expect(buildCorpus(pages, 42)).toEqual(buildCorpus(pages, 42));
  });

  it('a different seed changes at least one case', () => {
    const a = buildCorpus(pages, 42).map((c) => c.truth.selector);
    const b = buildCorpus(pages, 43).map((c) => c.truth.selector);
    expect(a).not.toEqual(b);
  });
});
