// parse5 helpers shared by edit ops and the guard.
import { parse, type DefaultTreeAdapterMap, type ParserError } from 'parse5';

export type Element = DefaultTreeAdapterMap['element'];
type Node = DefaultTreeAdapterMap['node'];

export type ParsedNode =
  { kind: 'element'; element: Element } | { kind: 'text' | 'comment'; value: string };

/** Every element, text and comment node in document order, including <template> content. */
export function parseNodes(html: string): { nodes: ParsedNode[]; errors: ParserError[] } {
  const errors: ParserError[] = [];
  const doc = parse(html, { sourceCodeLocationInfo: true, onParseError: (e) => errors.push(e) });
  const nodes: ParsedNode[] = [];
  const walk = (n: Node) => {
    if ('tagName' in n) nodes.push({ kind: 'element', element: n });
    else if (n.nodeName === '#text' && 'value' in n) nodes.push({ kind: 'text', value: n.value });
    else if (n.nodeName === '#comment' && 'data' in n)
      nodes.push({ kind: 'comment', value: n.data });
    if ('content' in n) walk(n.content);
    if ('childNodes' in n) for (const c of n.childNodes) walk(c);
  };
  walk(doc);
  return { nodes, errors };
}
