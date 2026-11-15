/// <reference lib="dom" />
// Scanner (v1.0 §9.1 steps 1-2): render a page and run axe-core. The MVP rules become findings;
// every other violation is kept for the URL-only report (FR-29, D-041).
// The caller owns the BrowserContext, so sandbox and egress-proxy settings (D-017) live there; it must
// carry the in-app egress guard (guardContext) too.
import axe from 'axe-core';
import type { BrowserContext } from 'playwright';
import { checkUrl, guardResolver } from './url-safety.ts';

export type RuleId = 'html-has-lang' | 'image-alt' | 'label';

/** axe rule -> Beacon rule. axe checks <select> under its own rule, which our label rule covers. */
const ENGINE_RULES: Record<string, RuleId> = {
  'html-has-lang': 'html-has-lang',
  'image-alt': 'image-alt',
  label: 'label',
  'select-name': 'label',
};

export type Finding = {
  page_url: string;
  rule_id: RuleId;
  engine_rule: string;
  impact: string;
  target: string;
  html: string;
};

const NAVIGATION_TIMEOUT_MS = 30_000;

export async function scanPage(context: BrowserContext, rawUrl: string): Promise<Finding[]> {
  return (await scanPageContent(context, rawUrl)).findings;
}

/** An axe violation outside the rules Beacon fixes: reported only, never a proposal (FR-29). */
export type ReportedIssue = {
  page_url: string;
  engine_rule: string;
  impact: string;
  target: string;
  html: string;
  help: string;
  tags: string[];
};

/** A scanned page: the HTML as served (for the mapper), its rendered visible text and its findings. */
export type PageContent = {
  served: string;
  text: string;
  findings: Finding[];
  reported: ReportedIssue[];
};

export async function scanPageContent(
  context: BrowserContext,
  rawUrl: string,
): Promise<PageContent> {
  const { url } = await checkUrl(rawUrl, guardResolver(context));
  const page = await context.newPage();
  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response) throw new Error(`no response for ${url}`);
    const served = await response.text();
    // evaluate() goes through the devtools protocol, so a page CSP cannot block the injection.
    await page.evaluate(axe.source);
    const results = await page.evaluate(() =>
      (window as unknown as { axe: typeof axe }).axe.run(document, { resultTypes: ['violations'] }),
    );
    // shortcut: iframe and shadow-DOM targets are nested arrays; MVP pages are static HTML.
    const nodesOf = (v: (typeof results.violations)[number]) =>
      v.nodes.map((n) => ({
        page_url: url,
        engine_rule: v.id,
        impact: v.impact ?? 'unknown',
        target: String(n.target[0]),
        html: n.html,
      }));
    const findings: Finding[] = [];
    const reported: ReportedIssue[] = [];
    for (const v of results.violations) {
      const rule = ENGINE_RULES[v.id];
      if (rule) findings.push(...nodesOf(v).map((n) => ({ ...n, rule_id: rule })));
      else reported.push(...nodesOf(v).map((n) => ({ ...n, help: v.help, tags: v.tags })));
    }
    const text = await page.evaluate(() => document.body.innerText);
    return { served, text, findings, reported };
  } finally {
    await page.close();
  }
}
