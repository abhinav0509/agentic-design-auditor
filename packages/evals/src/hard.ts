// The hard-case set (v1.0 §15.1, D-030): hand-written pages with one violation each, labelled with
// what a good answer is. `alt` is a case-insensitive pattern the fix's alt must match; `ask` means
// the right answer is a question or a decline, and any patch is a forced bad fix.
import { readFileSync } from 'node:fs';
import type { RuleId } from './oracle.ts';

export type HardExpect = { alt: string } | { ask: true };
export type HardCase = { id: string; rule: RuleId; why: string; html: string; expect: HardExpect };

const DIR = new URL('../../../fixtures/corpus/hard/', import.meta.url);

export function loadHardCases(): HardCase[] {
  const labels = JSON.parse(readFileSync(new URL('cases.json', DIR), 'utf8')) as (Omit<
    HardCase,
    'html'
  > & { file: string })[];
  return labels.map(({ file, ...c }) => ({ ...c, html: readFileSync(new URL(file, DIR), 'utf8') }));
}
