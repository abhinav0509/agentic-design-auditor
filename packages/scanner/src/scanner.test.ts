/// <reference lib="dom" />
// Scanner (v1.0 §9.1 steps 1-2): render with Playwright, run axe-core for the MVP rules only.
// Pages are served by Playwright routing; every other request is aborted, so no test touches the network.
import { buildCorpus, loadCleanPages } from '@beacon/evals';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanPage, scanPageContent } from './scanner.ts';
import { guardContext } from './url-safety.ts';

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
  crops: {
    html: doc(
      '<img src="x.png" width="40" height="30"><button style="width:80px;height:30px"></button>' +
        '<div role="button" style="width:3000px;height:3000px"></div>',
    ),
  },
  scripted: {
    html: doc('<p>Hello</p><img src="x.png"><script>document.body.append("Added")</script>'),
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
  // corpus.test stands in for a public site; the guard itself is tested in egress-guard.test.ts.
  await guardContext(context, () => Promise.resolve(['93.184.215.14']));
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

describe('scanPageContent', { timeout: 60_000 }, () => {
  it('FR-05: returns the HTML as served (not the rendered DOM), its visible text and its findings', async () => {
    const result = await scanPageContent(context, url('scripted'));

    expect(result.served).toBe(extra['scripted']?.html); // the mapper compares this with the repo file
    expect(result.text).toBe('Hello\n\nAdded'); // rendered: the script's text is what a visitor sees
    expect(result.findings).toMatchObject([{ rule_id: 'image-alt', target: 'img' }]);
  });

  it('FR-29: keeps every other axe violation for the report, with help text and WCAG tags', async () => {
    const result = await scanPageContent(context, url('other-problems'));

    expect(result.findings).toEqual([]);
    const rules = new Set(result.reported.map((r) => r.engine_rule));
    for (const rule of ['color-contrast', 'empty-heading', 'link-name'])
      expect(rules).toContain(rule);
    expect(result.reported.find((r) => r.engine_rule === 'link-name')).toEqual({
      page_url: url('other-problems'),
      engine_rule: 'link-name',
      impact: 'serious',
      target: 'a',
      html: '<a href="/x"></a>',
      help: 'Links must have discernible text',
      tags: expect.arrayContaining(['wcag2a', 'wcag244']) as string[],
    });
  });

  it('FR-29: an MVP rule is a finding, never also a reported item', async () => {
    const result = await scanPageContent(context, url('two-images'));

    expect(result.findings).toHaveLength(2);
    expect(result.reported.filter((r) => r.engine_rule === 'image-alt')).toEqual([]);
  });

  it('FR-29: with crops on, returns a PNG of each flagged element once, skipping any larger than the viewport', async () => {
    const result = await scanPageContent(context, url('crops'), { crops: true });

    expect(result.crops.map((c) => c.target).sort()).toEqual(['button', 'img']);
    for (const c of result.crops) expect([...c.png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const flagged = [...result.findings, ...result.reported].map((f) => f.target);
    expect(flagged).toEqual(expect.arrayContaining(['div', 'html'])); // flagged, too big to crop
  });

  it('FR-29: takes no crops unless asked', async () => {
    expect((await scanPageContent(context, url('crops'))).crops).toEqual([]);
  });
});
