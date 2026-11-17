/// <reference lib="dom" />
// Scanner (v1.0 §9.1 steps 1-2): render a page and run axe-core. The MVP rules become findings;
// every other violation is kept for the URL-only report (FR-29, D-041).
// The caller owns the BrowserContext, so sandbox and egress-proxy settings (D-017) live there; it must
// carry the in-app egress guard (guardContext) too.
import axe from 'axe-core';
import type { BrowserContext, Page } from 'playwright';
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
// shortcut: at most 50 crops a page (contrast alone can flag hundreds of nodes); raise it if reports need more.
const MAX_CROPS = 50;

/**
 * A PNG of each target that is visible and fits in the viewport. Bigger ones (the whole page for a
 * missing lang, a landmark wrapping everything) say nothing as a crop and are skipped.
 */
async function cropsOf(page: Page, targets: string[]): Promise<PageContent['crops']> {
  const viewport = page.viewportSize();
  const crops: PageContent['crops'] = [];
  for (const target of targets) {
    if (crops.length >= MAX_CROPS) break;
    const el = page.locator(`css=${target}`).first();
    const box = await el.boundingBox().catch(() => null);
    if (!box || box.width < 1 || box.height < 1) continue;
    if (viewport && (box.width > viewport.width || box.height > viewport.height)) continue;
    const png = await el.screenshot({ animations: 'disabled', timeout: 5_000 }).catch(() => null);
    if (png) crops.push({ target, png: new Uint8Array(png) });
  }
  return crops;
}

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
  /** PNG crops of flagged elements by target, when asked for (FR-29). */
  crops: { target: string; png: Uint8Array }[];
  /** What the review agent may judge, when asked for (FR-29, D-046). */
  review: { candidates: ReviewCandidate[]; images: { id: string; png: Uint8Array }[] };
};

export type ReviewCandidate =
  | { id: string; kind: 'image'; selector: string; alt: string; context: string }
  | { id: string; kind: 'link'; selector: string; text: string; href: string; context: string };

// shortcut: first 20 images and 30 links in document order; raise them if pilots' pages need more.
const MAX_REVIEW_IMAGES = 20;
const MAX_REVIEW_LINKS = 30;
const MAX_LINK_WORDS = 4; // vague link text is short; longer text says where it goes

/**
 * Images with alt text and links with short text: what rules cannot judge and the review agent may
 * (D-046). Code picks them, so the model only ever judges elements it was given.
 */
async function reviewOf(page: Page): Promise<PageContent['review']> {
  const raw = await page.evaluate(
    ({ maxImages, maxLinks, maxWords }) => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width >= 1 && r.height >= 1 && s.visibility !== 'hidden';
      };
      const path = (el: Element): string => {
        const parts: string[] = [];
        for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) {
          const tag = e.tagName;
          const same = e.parentElement
            ? Array.from(e.parentElement.children).filter((x) => x.tagName === tag)
            : [e];
          parts.unshift(`${tag.toLowerCase()}:nth-of-type(${String(same.indexOf(e) + 1)})`);
        }
        return `html > ${parts.join(' > ')}`;
      };
      const tidy = (t: string, max: number) => t.replace(/\s+/g, ' ').trim().slice(0, max);
      const near = (el: Element) => {
        const block = el.closest('p, li, figure, td, th, dd, blockquote, h1, h2, h3, h4, h5, h6');
        return block instanceof HTMLElement ? tidy(block.innerText, 200) : '';
      };
      const images = Array.from(document.querySelectorAll('img[alt]'))
        .filter((img) => (img.getAttribute('alt') ?? '').trim() !== '' && visible(img))
        .slice(0, maxImages)
        .map((img) => ({
          kind: 'image' as const,
          selector: path(img),
          alt: tidy(img.getAttribute('alt') ?? '', 300),
          context: near(img),
        }));
      const links = Array.from(document.querySelectorAll('a[href]'))
        .filter((a): a is HTMLAnchorElement => a instanceof HTMLAnchorElement && visible(a))
        .map((a) => ({ a, text: tidy(a.getAttribute('aria-label') ?? a.innerText, 200) }))
        .filter(({ text }) => text !== '' && text.split(' ').length <= maxWords)
        .slice(0, maxLinks)
        .map(({ a, text }) => ({
          kind: 'link' as const,
          selector: path(a),
          text,
          href: a.href,
          context: near(a),
        }));
      return [...images, ...links];
    },
    { maxImages: MAX_REVIEW_IMAGES, maxLinks: MAX_REVIEW_LINKS, maxWords: MAX_LINK_WORDS },
  );
  const candidates = raw.map((c, i) => ({ ...c, id: `c${String(i + 1)}` }));
  const imageIds = new Map(
    candidates.filter((c) => c.kind === 'image').map((c) => [c.selector, c.id]),
  );
  const images = (await cropsOf(page, [...imageIds.keys()])).flatMap((c) => {
    const id = imageIds.get(c.target);
    return id === undefined ? [] : [{ id, png: c.png }];
  });
  return { candidates, images };
}

export async function scanPageContent(
  context: BrowserContext,
  rawUrl: string,
  options: { crops?: boolean; review?: boolean } = {},
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
    const targets = [...new Set([...findings, ...reported].map((f) => f.target))];
    const crops = options.crops ? await cropsOf(page, targets) : [];
    const review = options.review ? await reviewOf(page) : { candidates: [], images: [] };
    return { served, text, findings, reported, crops, review };
  } finally {
    await page.close();
  }
}
