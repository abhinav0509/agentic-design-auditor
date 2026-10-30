/// <reference lib="dom" />
// Scanner (v1.0 §9.1 steps 1-2): render with Playwright, run axe-core for the MVP rules only.
// Pages are served by Playwright routing; every other request is aborted, so no test touches the network.
import { buildCorpus, loadCleanPages } from '@beacon/evals';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanPage } from './scanner.ts';

const ORIGIN = 'https://corpus.test';
const url = (id: string) => `${ORIGIN}/${id}.html`;
const doc = (body: string) =>
  `<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`;

const clean = loadCleanPages();
const corpus = buildCorpus(clean, 42);
const extra: Record<string, { html: string; headers?: Record<string, string> }> = {
  'one-image': { html: doc('<main><img src="x.png"></main>') },
  'two-images': { html: doc('<img src="a.png">\n<img src="b.png">') },
  'select-only': { html: doc('<select><option>a</option></select>') },
  'other-problems': {
    html: doc(
      '<h3></h3><p style="color:#eee;background:#fff">faint</p><a href="/x"></a><div id="d"></div><div id="d"></div>',
    ),
  },
  'strict-csp': {
    html: doc('<img src="x.png">'),
    headers: { 'content-security-policy': "default-src 'none'; script-src 'none'" },
  },
};

let browser: Browser;
let context: BrowserContext;

async function sameElement(id: string, a: string, b: string): Promise<boolean> {
  const page = await context.newPage();
  try {
    await page.goto(url(id));
    return await page.evaluate(
      ([x, y]) => {
        const el = document.querySelector(x);
        return el !== null && el === document.querySelector(y);
      },
      [a, b] as const,
    );
  } finally {
    await page.close();
  }
}

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pages = new Map<string, { html: string; headers?: Record<string, string> }>([
    ...clean.map((p) => [url(p.id), { html: p.html }] as const),
    ...corpus.map((c) => [url(c.id), { html: c.html }] as const),
    ...Object.entries(extra).map(([id, p]) => [url(id), p] as const),
  ]);
  await context.route('**/*', (route) => {
    const page = pages.get(route.request().url());
    return page
      ? route.fulfill({ contentType: 'text/html', body: page.html, headers: page.headers ?? {} })
      : route.abort();
  });
}, 60_000);

afterAll(async () => {
  await browser.close();
});

describe('scanPage', { timeout: 60_000 }, () => {
  it('reports nothing on the ten clean pages', async () => {
    for (const p of clean) expect(await scanPage(context, url(p.id)), p.id).toEqual([]);
  });

  it.each(corpus)('finds exactly the injected violation in $id', async (c) => {
    const findings = await scanPage(context, url(c.id));
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.rule_id).toBe(c.truth.rule);
    expect(await sameElement(c.id, finding?.target ?? '', c.truth.selector)).toBe(true);
  });

  it('a finding carries page url, rule, engine rule, impact, target and html snippet', async () => {
    expect(await scanPage(context, url('one-image'))).toEqual([
      {
        page_url: url('one-image'),
        rule_id: 'image-alt',
        engine_rule: 'image-alt',
        impact: 'critical',
        target: 'img',
        html: '<img src="x.png">',
      },
    ]);
  });

  it('keeps the engine impact per rule (a missing lang is serious, not critical)', async () => {
    expect(await scanPage(context, url('about--html-has-lang'))).toMatchObject([
      { rule_id: 'html-has-lang', impact: 'serious' },
    ]);
  });

  it('reports every instance on a page', async () => {
    const findings = await scanPage(context, url('two-images'));
    expect(findings.map((f) => f.rule_id)).toEqual(['image-alt', 'image-alt']);
    expect(new Set(findings.map((f) => f.target)).size).toBe(2);
  });

  it('reports an unlabelled <select> under label, keeping the engine rule select-name', async () => {
    expect(await scanPage(context, url('select-only'))).toMatchObject([
      { rule_id: 'label', engine_rule: 'select-name' },
    ]);
  });

  it('runs only the MVP rules', async () => {
    expect(await scanPage(context, url('other-problems'))).toEqual([]);
  });

  it('still scans a page whose CSP forbids all scripts', async () => {
    expect(await scanPage(context, url('strict-csp'))).toMatchObject([{ rule_id: 'image-alt' }]);
  });
});
