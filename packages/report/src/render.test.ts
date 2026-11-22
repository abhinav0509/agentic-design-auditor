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
    expect(html).toContain('An AI agent also noticed 1 likely issue for a human to confirm.');
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

describe('renderReport: proposed fixes', () => {
  const ID = '00000000-0000-4000-8000-000000000a01';
  const FIX = {
    id: ID,
    status: 'applied',
    title: 'Add alt text to the studio photo',
    rationale: 'The photo shows the studio at work.',
    ruleId: 'image-alt',
    pageUrl: 'https://acme.test/about.html',
    file: 'about.html',
    diff: '--- a/about.html\n+++ b/about.html\n@@ -7 +7 @@\n-<img src="img/studio.jpg">\n+<img src="img/studio.jpg" alt="Potter shaping a bowl on a wheel">\n',
    risk: 'low',
    announcedBefore: '- img',
    announcedAfter: '- img "Potter shaping a bowl on a wheel"',
    crop: CROP,
  };
  const withFixes = (
    fixes = [FIX],
    pullRequests = [
      {
        number: 4,
        url: 'https://github.com/jo/shop/pull/4',
        branch: 'beacon/x/y',
        proposalIds: [ID],
      },
    ],
  ) => sample({ fixes, pullRequests });

  it('FR-10: shows each fix with its status, risk, what a screen reader announces before and after, and the change', () => {
    const html = render(
      withFixes(
        [
          FIX,
          { ...FIX, id: 'p2', status: 'pending', title: 'Label the name field', risk: 'medium' },
        ],
        [],
      ),
    );

    expect(html).toContain('Fixes Beacon proposes');
    expect(html).toContain('Waiting for approval');
    expect(html).toContain('Medium risk');
    expect(html).toContain('What a screen reader announces');
    expect(html).toContain('Potter shaping a bowl on a wheel');
    expect(html).toContain('Show the change');
    expect(complianceClaims(html)).toEqual([]);
  });

  it('FR-14: an applied fix links to the pull request it is in', () => {
    const html = render(withFixes());

    expect(html).toContain('In pull request #4');
    expect(html).toContain('href="https://github.com/jo/shop/pull/4"');
  });

  it('NFR-02: the diff and the announced text are shown as text, never as markup', () => {
    const html = render(
      withFixes(
        [
          {
            ...FIX,
            diff: '+<script>alert(1)</script>\n',
            announcedAfter: '<img src=x onerror=alert(1)>',
          },
        ],
        [],
      ),
    );

    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
  });

  it.each(['light', 'dark'] as const)(
    'NFR-06: the report with fixes has no axe violations (%s)',
    { timeout: 60_000 },
    async (colorScheme) => {
      const context = await browser.newContext({ colorScheme });
      try {
        const url = 'https://report.test/r/tok';
        const html = render(
          withFixes([FIX, { ...FIX, id: 'p2', status: 'failed_verification', risk: 'high' }]),
        );
        await context.route('**/*', (route) =>
          route.request().url() === url
            ? route.fulfill({ contentType: 'text/html', body: html })
            : route.fulfill({ contentType: 'image/png', body: Buffer.alloc(0) }),
        );
        await guardContext(context, () => Promise.resolve(['93.184.215.14']));
        const page = await context.newPage();
        await page.goto(url);
        await page.evaluate(() => {
          document.querySelectorAll('details').forEach((d) => (d.open = true));
        });
        const { findings, reported } = await scanPageContent(context, url);
        expect([...findings, ...reported].map((f) => `${f.engine_rule} ${f.target}`)).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
});

describe('renderReport: reviewer controls', () => {
  const fix = (id: string, status: string, title: string) => ({
    id,
    status,
    title,
    rationale: 'Why.',
    ruleId: 'image-alt',
    pageUrl: 'https://acme.test/about.html',
    file: 'about.html',
    diff: '-a\n+b\n',
    risk: 'low',
    announcedBefore: '- img',
    announcedAfter: '- img "A potter"',
    crop: null,
  });
  const input = sample({
    fixes: [
      fix('p1', 'pending', 'Add alt text'),
      fix('p2', 'approved', 'Add lang'),
      fix('p3', 'approved', 'Label the field'),
    ],
    pullRequests: [],
  });
  const reviewer = (notice?: string) =>
    renderReport(buildReport(input), {
      siteUrl: SITE,
      scannedAt: input.scannedAt,
      expiresAt: '2026-11-29T10:00:00.000Z',
      cropUrl: (ref) => ref,
      review: { actionBase: '/review/tok', ...(notice ? { notice } : {}) },
    });

  it('FR-11: the share page has no controls at all', () => {
    expect(render(input)).not.toContain('<form');
  });

  it('FR-11: a waiting fix has Approve and Reject; approved fixes can go into one pull request', () => {
    const html = reviewer();

    expect(html).toContain('action="/review/tok/approve/p1"');
    expect(html).toContain('action="/review/tok/reject/p1"');
    expect(html).not.toContain('action="/review/tok/approve/p2"');
    expect(html).toContain('action="/review/tok/export"');
    expect(html).toContain('Open a pull request with 2 approved fixes');
    expect(html).toContain('method="post"');
  });

  it('FR-11: shows the outcome of the last action as a status message', () => {
    expect(reviewer('Approved “Add alt text”.')).toMatch(
      /role="status"[^>]*>[^<]*Approved “Add alt text”\./,
    );
  });

  it.each(['light', 'dark'] as const)(
    'NFR-06: the reviewer page has no axe violations (%s)',
    { timeout: 60_000 },
    async (colorScheme) => {
      const context = await browser.newContext({ colorScheme });
      try {
        const url = 'https://report.test/review/tok';
        const html = reviewer('Approved “Add alt text”.');
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

describe('renderReport: fix previews (URL only)', () => {
  const PREVIEW = {
    pageUrl: 'https://acme.test/about.html',
    ruleId: 'image-alt',
    title: 'Add alt text to the studio photo',
    rationale: 'The photo shows the studio at work.',
    before: '<img src="img/studio.jpg">',
    after: '<img src="img/studio.jpg" alt="Potter shaping a bowl on a wheel">',
    announcedBefore: '- img',
    announcedAfter: '- img "Potter shaping a bowl on a wheel"',
    verified: true,
    crop: CROP as string | null,
  };
  const withPreviews = (previews = [PREVIEW]) => sample({ previews });

  it('FR-29: shows each fix Beacon would make, checked on a copy of the live page, and what applying it needs', () => {
    const html = render(
      withPreviews([PREVIEW, { ...PREVIEW, title: 'Label the field', verified: false }]),
    );

    expect(html).toContain('Fixes Beacon would make');
    expect(html).toContain('Checked on a copy of the live page');
    expect(html).toContain('Did not pass the check');
    expect(html).toContain('What a screen reader announces');
    expect(html).toContain('access to the site’s code');
    expect(html).toContain(
      '&lt;img src=&quot;img/studio.jpg&quot; alt=&quot;Potter shaping a bowl on a wheel&quot;&gt;',
    );
    expect(complianceClaims(html)).toEqual([]);
  });

  it('NFR-02: before and after are page content, shown as text', () => {
    const html = render(
      withPreviews([
        { ...PREVIEW, before: '<script>alert(1)</script>', after: '<img src=x onerror=alert(1)>' },
      ]),
    );

    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
  });

  it.each(['light', 'dark'] as const)(
    'NFR-06: the report with previews has no axe violations (%s)',
    { timeout: 60_000 },
    async (colorScheme) => {
      const context = await browser.newContext({ colorScheme });
      try {
        const url = 'https://report.test/r/tok';
        const html = render(
          withPreviews([
            PREVIEW,
            { ...PREVIEW, title: 'Label the field', verified: false, crop: null },
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
