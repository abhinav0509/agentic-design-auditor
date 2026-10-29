// Deterministic mutations (v1.0 §15.1): remove the attributes a fix would add, so each mutation
// injects exactly one known violation.
import { applyEditOps, type EditOp, type Element } from '@beacon/core';
import {
  attr,
  elementsOf,
  insideLabel,
  isLabelTarget,
  lineOf,
  selectorOf,
  type RuleId,
} from './oracle.ts';

export { RULES, type RuleId } from './oracle.ts';

type Candidate = { target: Element; ops: EditOp[] };

const startOf = (el: Element) => el.sourceCodeLocation?.startTag?.startOffset ?? -1;
const remove = (el: Element, name: string): EditOp => ({
  op: 'remove_attr',
  at: startOf(el),
  name,
});

/** Seeded PRNG (mulberry32), so the same seed always picks the same target. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function candidates(els: Element[], rule: RuleId): Candidate[] {
  switch (rule) {
    case 'html-has-lang':
      return els
        .filter((e) => e.tagName === 'html' && attr(e, 'lang') !== undefined)
        .map((e) => ({ target: e, ops: [remove(e, 'lang')] }));
    case 'image-alt':
      return els
        .filter((e) => e.tagName === 'img' && attr(e, 'alt') !== undefined)
        .map((e) => ({ target: e, ops: [remove(e, 'alt')] }));
    case 'label':
      // Wrapped controls are skipped: removing an attribute cannot unlabel them.
      return els.flatMap((e) => {
        if (!isLabelTarget(e) || insideLabel(e)) return [];
        const id = attr(e, 'id');
        const ops = [
          ...['aria-label', 'aria-labelledby']
            .filter((n) => attr(e, n) !== undefined)
            .map((n) => remove(e, n)),
          ...els
            .filter((l) => l.tagName === 'label' && id !== undefined && attr(l, 'for') === id)
            .map((l) => remove(l, 'for')),
        ];
        return ops.length > 0 ? [{ target: e, ops }] : [];
      });
  }
}

export function mutate(
  html: string,
  rule: RuleId,
  seed: number,
): { html: string; selector: string; line: number } | null {
  const els = elementsOf(html);
  const options = candidates(els, rule);
  const pick = options[Math.floor(random(seed)() * options.length)];
  if (!pick) return null;

  const out = applyEditOps(html, pick.ops);
  // Only attributes were removed, so the target keeps its position in document order.
  const target = elementsOf(out)[els.indexOf(pick.target)];
  if (!target) throw new Error('mutation changed the document structure');
  return { html: out, selector: selectorOf(target), line: lineOf(target) };
}
