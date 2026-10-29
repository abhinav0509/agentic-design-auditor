// Edit ops (addendum A.1, D-009): the agent names an element and an attribute; this code writes the
// bytes, so only the target start tag changes and values cannot break out of the attribute.
import { DomainError } from './errors.ts';
import { parseNodes, type Element } from './html.ts';

export type EditOp =
  | { op: 'set_attr'; at: number; name: string; value: string }
  | { op: 'remove_attr'; at: number; name: string };

type Splice = { start: number; end: number; text: string };

// \n as a character reference keeps the file's line count (and the guard's line diff) unchanged.
const escapeAttr = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '&#10;');

function startTagsByOffset(source: string): Map<number, Element> {
  const map = new Map<number, Element>();
  for (const n of parseNodes(source).nodes) {
    const loc = n.kind === 'element' ? n.element.sourceCodeLocation?.startTag : undefined;
    if (n.kind === 'element' && loc) map.set(loc.startOffset, n.element);
  }
  return map;
}

function toSplice(source: string, el: Element, op: EditOp): Splice {
  const tag = el.sourceCodeLocation?.startTag;
  const attrs = el.sourceCodeLocation?.attrs ?? {};
  if (!tag) throw new DomainError('EDIT_TARGET_NOT_FOUND');
  const name = op.name.toLowerCase();
  const attr = attrs[name];

  if (op.op === 'remove_attr') {
    if (!attr) throw new DomainError('EDIT_TARGET_NOT_FOUND', `no ${name} attribute to remove`);
    let start = attr.startOffset;
    while (start > tag.startOffset && /\s/.test(source.charAt(start - 1))) start--;
    return { start, end: attr.endOffset, text: '' };
  }

  const text = `${name}="${escapeAttr(op.value)}"`;
  if (attr) return { start: attr.startOffset, end: attr.endOffset, text };
  const ends = Object.values(attrs).map((a) => a.endOffset);
  const insertAt = ends.length > 0 ? Math.max(...ends) : tag.startOffset + 1 + el.tagName.length;
  return { start: insertAt, end: insertAt, text: ` ${text}` };
}

export function applyEditOps(source: string, ops: EditOp[]): string {
  const tags = startTagsByOffset(source);
  const splices = ops.map((op) => {
    const el = tags.get(op.at);
    if (!el)
      throw new DomainError('EDIT_TARGET_NOT_FOUND', `no start tag at offset ${String(op.at)}`);
    return toSplice(source, el, op);
  });
  // Apply from the end of the file backwards so earlier offsets stay valid.
  splices.sort((a, b) => b.start - a.start);
  return splices.reduce((out, s) => out.slice(0, s.start) + s.text + out.slice(s.end), source);
}
