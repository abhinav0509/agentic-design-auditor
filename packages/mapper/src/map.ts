// The source mapper (v1.0 §9.1 step 5, FR-06, D-007, D-033). MVP: static HTML served as-is. A finding
// maps only when the URL serves a repo file unchanged and exactly one element in it has the finding's
// start tag (tag name and attributes). Anything else is unmapped: report only, never a guess.
import { parseNodes } from '@beacon/core';
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

type Element = DefaultTreeAdapterMap['element'];
type Node = DefaultTreeAdapterMap['node'];

export type UnmappedReason = 'no_file' | 'not_served_as_is' | 'no_match' | 'ambiguous';
export type MapResult =
  | { mapped: true; file: string; at: number; line: number }
  | { mapped: false; reason: UnmappedReason };

/** The repo file a static host serves for this URL: /, /x, /x/, /x.html. */
function fileFor(files: Record<string, string | Uint8Array>, pageUrl: string) {
  const path = decodeURIComponent(new URL(pageUrl).pathname).replace(/^\/+/, '');
  const candidates =
    path === '' || path.endsWith('/')
      ? [`${path}index.html`]
      : path.endsWith('.html')
        ? [path]
        : [`${path}.html`, `${path}/index.html`];
  return candidates.find((c) => Object.hasOwn(files, c) && typeof files[c] === 'string');
}

const signature = (el: Element) =>
  [el.tagName, ...el.attrs.map((a) => `${a.name}=${a.value}`).sort()].join('\u0000');

function firstElement(n: Node, tag?: string): Element | undefined {
  if ('tagName' in n && (!tag || n.tagName === tag)) return n;
  const children = 'content' in n ? [n.content] : 'childNodes' in n ? n.childNodes : [];
  for (const c of children) {
    const found = firstElement(c, tag);
    if (found) return found;
  }
  return undefined;
}

/** The start tag of the engine's snippet. Fragment parsing drops html/head/body, so those parse as a document. */
function snippetElement(html: string): Element | undefined {
  const tag = /^\s*<([a-zA-Z][^\s/>]*)/.exec(html)?.[1]?.toLowerCase();
  if (!tag) return undefined;
  if (tag === 'html' || tag === 'head' || tag === 'body') return firstElement(parse(html), tag);
  return firstElement(parseFragment(`<template>${html}</template>`).childNodes[0] as Node, tag);
}

export function mapFinding(input: {
  /** The repo checkout: path relative to the root -> contents. */
  files: Record<string, string | Uint8Array>;
  pageUrl: string;
  /** The HTML the URL served, as fetched. */
  served: string;
  finding: { target: string; html: string };
}): MapResult {
  const file = fileFor(input.files, input.pageUrl);
  const source = file === undefined ? undefined : input.files[file];
  if (file === undefined || typeof source !== 'string') return { mapped: false, reason: 'no_file' };
  if (serialize(parse(input.served)) !== serialize(parse(source)))
    return { mapped: false, reason: 'not_served_as_is' };

  const wanted = snippetElement(input.finding.html);
  const matches = wanted
    ? parseNodes(source).nodes.flatMap((n) =>
        n.kind === 'element' &&
        n.element.sourceCodeLocation?.startTag &&
        signature(n.element) === signature(wanted)
          ? [n.element.sourceCodeLocation.startTag]
          : [],
      )
    : [];
  const [only, ...rest] = matches;
  if (!only) return { mapped: false, reason: 'no_match' };
  if (rest.length > 0) return { mapped: false, reason: 'ambiguous' };
  return { mapped: true, file, at: only.startOffset, line: only.startLine };
}
