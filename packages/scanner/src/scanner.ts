/// <reference lib="dom" />
// Scanner (v1.0 §9.1 steps 1-2): render a page and run axe-core for the MVP rules only.
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
  const { url } = await checkUrl(rawUrl, guardResolver(context));
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAVIGATION_TIMEOUT_MS });
    // evaluate() goes through the devtools protocol, so a page CSP cannot block the injection.
    await page.evaluate(axe.source);
    const results = await page.evaluate(
      (rules) =>
        (window as unknown as { axe: typeof axe }).axe.run(document, {
          runOnly: { type: 'rule', values: rules },
          resultTypes: ['violations'],
        }),
      Object.keys(ENGINE_RULES),
    );
    return results.violations.flatMap((v) => {
      const rule = ENGINE_RULES[v.id];
      if (!rule) throw new Error(`axe returned an unrequested rule: ${v.id}`);
      return v.nodes.map((n) => ({
        page_url: url,
        rule_id: rule,
        engine_rule: v.id,
        impact: v.impact ?? 'unknown',
        // shortcut: iframe and shadow-DOM targets are nested arrays; MVP pages are static HTML.
        target: String(n.target[0]),
        html: n.html,
      }));
    });
  } finally {
    await page.close();
  }
}
