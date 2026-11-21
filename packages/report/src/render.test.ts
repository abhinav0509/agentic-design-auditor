import { complianceClaims } from '@beacon/core';
import { guardContext, scanPageContent } from '@beacon/scanner';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildReport, type ReportInput } from './build.ts';
import { renderReport } from './render.ts';

const SITE = 'https://acme.test/';
const CROP = `blob://sha256/${'b'.repeat(64)}.png`;
const sample = (o: Partial<ReportInput> = {}): ReportInput => ({
  siteUrl: SITE,
  scannedAt: '2026-11-15T10:00:00.000Z',
  pages: [
    { url: SITE, error: null },
    { url: 'https://acme.test/admin', error: 'URL_NOT_ALLOWED' },
  ],
  issues: [
    {
      pageUrl: SITE,
      ruleId: 'image-alt',
      actionable: true,
      impact: 'critical',
      selector: 'img',
      html: '<img src="hero.jpg">',
      help: null,
      tags: [],
      crop: CROP,
    },
    {
      pageUrl: SITE,
      ruleId: 'region',
      actionable: false,
      impact: 'moderate',
      selector: 'h1',
      html: '<h1>Hi</h1>',
      help: 'All page content should be contained by landmarks',
      tags: ['best-practice'],
      crop: null,
    },
  ],
  ...o,
});
const render = (input = sample()) =>
  renderReport(buildReport(input), {
    siteUrl: input.siteUrl,
    scannedAt: input.scannedAt,
    expiresAt: '2026-11-29T10:00:00.000Z',
    cropUrl: (ref) => `/r/tok/crops/${ref.slice(-68)}`,
  });

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser.close();
});

describe('renderReport', () => {
  it('FR-31: Beacon’s own words in the report make no compliance claim', () => {
    expect(complianceClaims(render())).toEqual([]);
  });

  it('FR-17: shows totals, each issue group with its references, crops, unscanned pages and what was not checked', () => {
    const html = render();

    expect(html).toContain('Images need a text alternative');
    expect(html).toContain('WCAG 1.1.1');
    expect(html).toContain('Best practice, not a WCAG requirement');
    expect(html).toContain(`src="/r/tok/crops/${CROP.slice(-68)}"`);
    expect(html).toContain('https://acme.test/admin');
    expect(html).toMatch(/keyboard/i);
    expect(html).toMatch(/expires/i);
  });

  it('NFR-02: page content is shown as text, never as markup', () => {
    const hostile = sample({
      issues: [
        {
          pageUrl: 'https://acme.test/"><script>alert(1)</script>',
          ruleId: 'link-name',
          actionable: false,
          impact: 'serious',
          selector: 'a[onclick="x"]',
          html: '<a href="javascript:alert(1)"><img src=x onerror=alert(1)></a>',
          help: '<b>bold</b> help',
          tags: [],
          crop: null,
        },
      ],
    });

    const html = render(hostile);

    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;');
  });

  it.each(['light', 'dark'] as const)(
    'NFR-06: the report page itself has no axe violations, best practice included (%s)',
    { timeout: 60_000 },
    async (colorScheme) => {
      const context = await browser.newContext({ colorScheme });
      try {
        const url = 'https://report.test/r/tok';
        const html = render();
        await context.route('**/*', (route) =>
          route.request().url() === url
            ? route.fulfill({ contentType: 'text/html', body: html })
            : route.fulfill({ contentType: 'image/png', body: Buffer.alloc(0) }),
        );
        await guardContext(context, () => Promise.resolve(['93.184.215.14']));
        const { findings, reported } = await scanPageContent(context, url);
        expect([...findings, ...reported].map((f) => `${f.engine_rule} ${f.target}`)).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
});

describe('renderReport: agent review', () => {
  const withReview = (flags: NonNullable<ReportInput['reviewFlags']>) =>
    sample({
      reviewedPages: [SITE],
      reviewFlags: flags,
    });
  const FLAG = {
    pageUrl: SITE,
    candidate: 'image' as const,
    kind: 'unhelpful_alt' as const,
    selector: 'img',
    text: 'IMG_0042.jpg',
    reason: 'The alt text is a camera file name.',
    suggestion: 'Potter shaping a bowl at the wheel',
    crop: CROP,
  };

  it('FR-29: shows each likely issue as needing a human, with the suggestion marked as untested', () => {
    const html = render(withReview([FLAG]));

    expect(html).toContain('Likely issues');
    expect(html).toContain('Needs a human to confirm');
    expect(html).toContain('Suggestion, not tested on your site');
    expect(html).toContain('Potter shaping a bowl at the wheel');
    expect(html).toContain('IMG_0042.jpg');
    expect(complianceClaims(html)).toEqual([]);
  });

  it('NFR-02: agent and page text in the review section is shown as text, never as markup', () => {
    const html = render(
      withReview([
        {
          ...FLAG,
          text: '<img src=x onerror=alert(1)>',
          reason: '<b>r</b>',
          suggestion: '<script>s</script>',
        },
      ]),
    );

    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>r</b>');
    expect(html).not.toContain('<script>s');
  });

  it.each(['light', 'dark'] as const)(
    'NFR-06: the report with a review section has no axe violations (%s)',
    { timeout: 60_000 },
    async (colorScheme) => {
      const context = await browser.newContext({ colorScheme });
      try {
        const url = 'https://report.test/r/tok';
        const html = render(
          withReview([
            FLAG,
            {
              ...FLAG,
              candidate: 'link',
              kind: 'vague_link',
              selector: 'a',
              text: 'click here',
              suggestion: 'See workshop prices',
              crop: null,
            },
          ]),
        );
        await context.route('**/*', (route) =>
          route.request().url() === url
            ? route.fulfill({ contentType: 'text/html', body: html })
            : route.fulfill({ contentType: 'image/png', body: Buffer.alloc(0) }),
        );
        await guardContext(context, () => Promise.resolve(['93.184.215.14']));
        const { findings, reported } = await scanPageContent(context, url);
        expect([...findings, ...reported].map((f) => `${f.engine_rule} ${f.target}`)).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
});
