// Corpus v0 (v1.0 §15.1): clean pages × MVP rules, one injected violation per case.
import { readdirSync, readFileSync } from 'node:fs';
import { mutate, RULES, type RuleId } from './mutate.ts';

export type CleanPage = { id: string; html: string };
export type Truth = {
  case_id: string;
  page: string;
  file: string;
  rule: RuleId;
  selector: string;
  line: number;
};
export type CorpusCase = { id: string; page: string; html: string; truth: Truth };

const CLEAN_DIR = new URL('../../../fixtures/corpus/clean/', import.meta.url);

export function loadCleanPages(dir: URL = CLEAN_DIR): CleanPage[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => ({ id: f.slice(0, -'.html'.length), html: readFileSync(new URL(f, dir), 'utf8') }));
}

/** FNV-1a, so each case gets its own stable seed derived from the corpus seed. */
function caseSeed(seed: number, page: string, rule: RuleId): number {
  let h = 0x811c9dc5;
  for (const ch of `${String(seed)}:${page}:${rule}`)
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

export function buildCorpus(pages: CleanPage[], seed: number): CorpusCase[] {
  return pages.flatMap((p) =>
    RULES.flatMap((rule) => {
      const m = mutate(p.html, rule, caseSeed(seed, p.id, rule));
      if (!m) return [];
      const id = `${p.id}--${rule}`;
      const truth = {
        case_id: id,
        page: p.id,
        file: `${p.id}.html`,
        rule,
        selector: m.selector,
        line: m.line,
      };
      return [{ id, page: p.id, html: m.html, truth }];
    }),
  );
}
