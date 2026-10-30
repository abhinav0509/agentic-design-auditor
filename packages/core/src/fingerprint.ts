// Finding fingerprints and cross-page dedupe (v1.0 §9.1 steps 3-4). The engine version is not part
// of the fingerprint (addendum A.4), so regression detection survives axe upgrades.
import { createHash } from 'node:crypto';
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

/** One engine violation on one page; the scanner's Finding satisfies this shape. */
export type RawFinding = {
  page_url: string;
  rule_id: string;
  impact: string;
  target: string;
  html: string;
};

export type DedupedFinding = {
  fingerprint: string;
  rule_id: string;
  impact: string;
  selector: string;
  html: string;
  occurrences: string[];
};

type Node = DefaultTreeAdapterMap['node'];

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Canonical snippet: attributes sorted, whitespace runs in text collapsed. Tag case is parse5's. */
function normaliseSnippet(html: string): string {
  // <html>/<head>/<body> fall out of a fragment parse; their rule + selector already identify them.
  const fragment = parseFragment(html);
  const walk = (n: Node) => {
    if ('attrs' in n) n.attrs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (n.nodeName === '#text' && 'value' in n) n.value = collapse(n.value);
    if ('content' in n) walk(n.content);
    if ('childNodes' in n) n.childNodes.forEach(walk);
  };
  walk(fragment);
  return serialize(fragment);
}

export function fingerprint(f: RawFinding): string {
  return sha256([f.rule_id, collapse(f.target), sha256(normaliseSnippet(f.html))].join('\0'));
}

/** Groups findings by fingerprint in first-seen order; the first occurrence supplies the fields. */
export function dedupeFindings(findings: RawFinding[]): DedupedFinding[] {
  const byPrint = new Map<string, DedupedFinding>();
  for (const f of findings) {
    const fp = fingerprint(f);
    const seen = byPrint.get(fp);
    if (!seen) {
      byPrint.set(fp, {
        fingerprint: fp,
        rule_id: f.rule_id,
        impact: f.impact,
        selector: collapse(f.target),
        html: f.html,
        occurrences: [f.page_url],
      });
    } else if (!seen.occurrences.includes(f.page_url)) seen.occurrences.push(f.page_url);
  }
  return [...byPrint.values()];
}
