// Independent checker for the three MVP rules: the corpus's ground-truth cross-check.
// shortcut: unlike axe, a non-empty title or placeholder does not count as a label; the corpus avoids both.
import { parseNodes, type Element } from '@beacon/core';

export const RULES = ['html-has-lang', 'image-alt', 'label'] as const;
export type RuleId = (typeof RULES)[number];
export type Violation = { rule: RuleId; selector: string; line: number };

const EXEMPT_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset']);

export const attr = (el: Element, name: string) => el.attrs.find((a) => a.name === name)?.value;

export const elementsOf = (html: string): Element[] =>
  parseNodes(html).nodes.flatMap((n) => (n.kind === 'element' ? [n.element] : []));

const parentOf = (el: Element): Element | null => {
  const p = el.parentNode;
  return p && 'tagName' in p ? p : null;
};

/** `html > body > main > img:nth-of-type(2)`: the target is always indexed, parents only when needed. */
export function selectorOf(target: Element): string {
  const parts: string[] = [];
  for (let el: Element | null = target; el; el = parentOf(el)) {
    const tag = el.tagName;
    const siblings =
      el.parentNode?.childNodes.filter((c) => 'tagName' in c && c.tagName === tag) ?? [];
    const indexed = el.tagName !== 'html' && (el === target || siblings.length > 1);
    parts.unshift(
      indexed ? `${el.tagName}:nth-of-type(${String(siblings.indexOf(el) + 1)})` : el.tagName,
    );
  }
  return parts.join(' > ');
}

export const lineOf = (el: Element) =>
  el.sourceCodeLocation?.startTag?.startLine ?? el.sourceCodeLocation?.startLine ?? 0;

export const isLabelTarget = (el: Element) =>
  el.tagName === 'select' ||
  el.tagName === 'textarea' ||
  (el.tagName === 'input' && !EXEMPT_INPUT_TYPES.has((attr(el, 'type') ?? 'text').toLowerCase()));

export function insideLabel(el: Element): boolean {
  for (let p = parentOf(el); p; p = parentOf(p)) if (p.tagName === 'label') return true;
  return false;
}

export function findViolations(html: string): Violation[] {
  const els = elementsOf(html);
  const ids = new Set(els.map((e) => attr(e, 'id')).filter((v) => v !== undefined));
  const labelled = new Set(
    els
      .filter((e) => e.tagName === 'label')
      .map((e) => attr(e, 'for'))
      .filter((v) => v !== undefined),
  );
  const isLabelled = (el: Element) => {
    const id = attr(el, 'id');
    const refs = attr(el, 'aria-labelledby')?.trim().split(/\s+/) ?? [];
    return (
      (attr(el, 'aria-label')?.trim() ?? '') !== '' ||
      refs.some((r) => ids.has(r)) ||
      (id !== undefined && labelled.has(id)) ||
      insideLabel(el)
    );
  };

  const out: Violation[] = [];
  const add = (rule: RuleId, el: Element) =>
    out.push({ rule, selector: selectorOf(el), line: lineOf(el) });
  for (const el of els) {
    if (el.tagName === 'html' && (attr(el, 'lang')?.trim() ?? '') === '') add('html-has-lang', el);
    if (el.tagName === 'img' && attr(el, 'alt') === undefined) add('image-alt', el);
    if (isLabelTarget(el) && !isLabelled(el)) add('label', el);
  }
  return out;
}
