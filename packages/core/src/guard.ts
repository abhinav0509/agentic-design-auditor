// Patch guard (v1.0 §9.3, addendum A.2). Pure code, security critical: a change passes only if the
// parsed trees differ in nothing but allowed attributes, for the rule being fixed.
import { createHash } from 'node:crypto';
import { parseNodes, type Element, type ParsedNode } from './html.ts';

export const GUARD_REASONS = [
  'ATTRIBUTE_NOT_ALLOWED',
  'BASE_MISMATCH',
  'DANGLING_REFERENCE',
  'DUPLICATE_ID',
  'EMPTY_PATCH',
  'EVENT_HANDLER',
  'FORBIDDEN_ELEMENT',
  'INVALID_HTML',
  'MULTI_FILE',
  'PATCH_TOO_LARGE',
  'PATH_INVALID',
  'STRUCTURE_CHANGED',
  'TEXT_CHANGED',
  'UNKNOWN_RULE',
  'VALUE_UNSAFE',
] as const;
export type GuardReason = (typeof GUARD_REASONS)[number];

export type GuardInput = {
  ruleId: string;
  baseHash: string;
  files: { path: string; before: string; after: string }[];
};
export type GuardResult = { ok: boolean; reasons: GuardReason[] };

const LABEL_ATTRS = ['aria-label', 'aria-labelledby', 'id'] as const;

/** Which attributes each verified rule may change, per element. */
const RULES: Record<string, Record<string, readonly string[]>> = {
  'image-alt': { img: ['alt'] },
  'html-has-lang': { html: ['lang'] },
  label: { input: LABEL_ATTRS, select: LABEL_ATTRS, textarea: LABEL_ATTRS, label: ['for'] },
};

const MAX_CHANGED_LINES = 30; // v1.0 §9.2

const FORBIDDEN = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'link', 'meta', 'base', 'form', 'template', 'noscript',
]); // prettier-ignore

// Parse errors about raw characters are left to the value checks (VALUE_UNSAFE / TEXT_CHANGED).
const CHARACTER_ERRORS = new Set([
  'control-character-in-input-stream',
  'noncharacter-in-input-stream',
  'surrogate-in-input-stream',
]);

const UNSAFE_TEXT =
  /[<>\p{Cc}\p{Cs}\p{Noncharacter_Code_Point}‪-‮⁦-⁩]|[a-z][a-z0-9+.-]*:\/\/|(?:javascript|vbscript):|\bdata:\S/iu;
const ID = /^[A-Za-z][\w:.-]{0,63}$/;
const ids = (v: string) => v.trim().split(/\s+/);

const VALUE_OK: Record<string, (v: string) => boolean> = {
  alt: (v) => v.length <= 250 && !UNSAFE_TEXT.test(v),
  'aria-label': (v) => v.trim().length > 0 && v.length <= 120 && !UNSAFE_TEXT.test(v),
  'aria-labelledby': (v) => v.trim().length > 0 && ids(v).every((id) => ID.test(id)),
  id: (v) => ID.test(v),
  for: (v) => ID.test(v),
  lang: (v) => /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(v),
};

const sha256 = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

function safePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  return path.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !s.includes('\0'));
}

const elementsOf = (nodes: ParsedNode[]): Element[] =>
  nodes.flatMap((n) => (n.kind === 'element' ? [n.element] : []));
const attrsOf = (el: Element) => new Map(el.attrs.map((a) => [a.name, a.value]));

/** Counts of each key; used to spot anything that appears more often after than before. */
function grew(before: string[], after: string[]): boolean {
  const count = new Map<string, number>();
  for (const k of before) count.set(k, (count.get(k) ?? 0) + 1);
  for (const k of after) {
    const left = (count.get(k) ?? 0) - 1;
    if (left < 0) return true;
    count.set(k, left);
  }
  return false;
}

function changedLines(before: string, after: string): number {
  const a = before.split('\n');
  const b = after.split('\n');
  let changed = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) changed++;
  return changed;
}

function compare(
  before: string,
  after: string,
  policy: Record<string, readonly string[]> | undefined,
  reasons: Set<GuardReason>,
) {
  const b = parseNodes(before);
  const a = parseNodes(after);
  const realErrors = (errs: { code: string }[]) =>
    errs.filter((e) => !CHARACTER_ERRORS.has(e.code));
  if (realErrors(a.errors).length > realErrors(b.errors).length) reasons.add('INVALID_HTML');
  if (changedLines(before, after) > MAX_CHANGED_LINES) reasons.add('PATCH_TOO_LARGE');

  const elB = elementsOf(b.nodes);
  const elA = elementsOf(a.nodes);
  const tags = (els: Element[]) => els.map((e) => e.tagName);
  const forbidden = (els: Element[]) => tags(els).filter((t) => FORBIDDEN.has(t));
  const handlers = (els: Element[]) =>
    els.flatMap((e) =>
      e.attrs.filter((x) => /^on/i.test(x.name)).map((x) => `${e.tagName} ${x.name}=${x.value}`),
    );
  const idList = (els: Element[]) =>
    els.flatMap((e) => e.attrs.filter((x) => x.name === 'id').map((x) => x.value));

  if (grew(forbidden(elB), forbidden(elA))) reasons.add('FORBIDDEN_ELEMENT');
  if (grew(handlers(elB), handlers(elA))) reasons.add('EVENT_HANDLER');
  if (grew(idList(elB), idList(elA)) && new Set(idList(elA)).size < idList(elA).length) {
    reasons.add('DUPLICATE_ID');
  }

  const texts = (nodes: ParsedNode[]) =>
    nodes.flatMap((n) => (n.kind === 'element' ? [] : [`${n.kind}:${n.value}`]));
  if (texts(b.nodes).join('\u0000') !== texts(a.nodes).join('\u0000')) reasons.add('TEXT_CHANGED');

  if (tags(elB).join(' ') !== tags(elA).join(' ')) {
    reasons.add('STRUCTURE_CHANGED');
    return; // attributes can only be compared element by element when the structure matches
  }
  // Same tags but the same elements in a different order (ignoring rule-editable attributes).
  const identity = (e: Element) =>
    [
      e.tagName,
      ...e.attrs
        .filter((x) => !policy?.[e.tagName]?.includes(x.name))
        .map((x) => `${x.name}=${x.value}`)
        .sort(),
    ].join('\u0000');
  const idB = elB.map(identity);
  const idA = elA.map(identity);
  if (idB.join('\u0001') !== idA.join('\u0001') && !grew(idB, idA) && !grew(idA, idB)) {
    reasons.add('STRUCTURE_CHANGED');
    return;
  }

  const existingIds = new Set(idList(elA));
  elA.forEach((after, i) => {
    const before = elB[i];
    if (!before) return;
    const was = attrsOf(before);
    const now = attrsOf(after);
    for (const name of new Set([...was.keys(), ...now.keys()])) {
      const value = now.get(name);
      if (was.get(name) === value) continue;
      if (/^on/i.test(name)) reasons.add('EVENT_HANDLER');
      if (!policy?.[after.tagName]?.includes(name)) {
        reasons.add('ATTRIBUTE_NOT_ALLOWED');
        continue;
      }
      if (value === undefined) continue; // removing an allowed attribute
      if (!(VALUE_OK[name]?.(value) ?? false)) {
        reasons.add('VALUE_UNSAFE');
        continue;
      }
      if (
        (name === 'for' || name === 'aria-labelledby') &&
        !ids(value).every((id) => existingIds.has(id))
      ) {
        reasons.add('DANGLING_REFERENCE');
      }
    }
  });
}

export function guard(input: GuardInput): GuardResult {
  const reasons = new Set<GuardReason>();
  const policy = RULES[input.ruleId];
  if (!policy) reasons.add('UNKNOWN_RULE');
  if (input.files.length !== 1) reasons.add('MULTI_FILE');
  if (input.files.some((f) => !safePath(f.path))) reasons.add('PATH_INVALID');

  const file = input.files[0];
  if (file) {
    if (sha256(file.before) !== input.baseHash) reasons.add('BASE_MISMATCH');
    if (file.before === file.after) reasons.add('EMPTY_PATCH');
    else compare(file.before, file.after, policy, reasons);
  }
  const sorted = [...reasons].sort();
  return { ok: sorted.length === 0, reasons: sorted };
}
