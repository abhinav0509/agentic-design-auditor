import { describe, expect, it } from 'vitest';
import { buildReport, type ReportInput } from './build.ts';

const SITE = 'https://acme.test/';
const issue = (o: Partial<ReportInput['issues'][number]>): ReportInput['issues'][number] => ({
  pageUrl: SITE,
  ruleId: 'link-name',
  actionable: false,
  impact: 'serious',
  selector: 'a',
  html: '<a href="/x"></a>',
  help: 'Links must have discernible text',
  tags: ['cat.name-role-value', 'wcag2a', 'wcag244', 'wcag412'],
  crop: null,
  ...o,
});
const input = (o: Partial<ReportInput> = {}): ReportInput => ({
  siteUrl: SITE,
  scannedAt: '2026-11-15T10:00:00.000Z',
  pages: [
    { url: SITE, error: null },
    { url: 'https://acme.test/about', error: null },
  ],
  issues: [],
  ...o,
});

describe('buildReport', () => {
  it('FR-29: groups issues by rule, most severe first, each with its pages, elements and crops', () => {
    const r = buildReport(
      input({
        issues: [
          issue({
            ruleId: 'region',
            impact: 'moderate',
            help: 'All page content should be contained by landmarks',
            tags: ['best-practice'],
            selector: 'h1',
            html: '<h1>Hi</h1>',
          }),
          issue({ crop: 'blob://sha256/' + 'a'.repeat(64) + '.png' }),
          issue({ pageUrl: 'https://acme.test/about', selector: 'footer a' }),
        ],
      }),
    );

    expect(r.groups.map((g) => [g.rule, g.count])).toEqual([
      ['link-name', 2],
      ['region', 1],
    ]);
    expect(r.groups[0]).toMatchObject({
      title: 'Links must have discernible text',
      impact: 'serious',
      kind: 'wcag',
      refs: ['WCAG 2.4.4', 'WCAG 4.1.2'],
      fixable: false,
    });
    expect(r.groups[0]?.instances[0]).toEqual({
      pageUrl: SITE,
      selector: 'a',
      html: '<a href="/x"></a>',
      crop: 'blob://sha256/' + 'a'.repeat(64) + '.png',
    });
    expect(r.groups[1]).toMatchObject({ kind: 'best-practice', refs: [] });
  });

  it('FR-29: the rules Beacon fixes carry their own title and WCAG references, and say they are fixable', () => {
    const r = buildReport(
      input({
        issues: [
          issue({
            ruleId: 'image-alt',
            actionable: true,
            impact: 'critical',
            help: null,
            tags: [],
            selector: 'img',
            html: '<img src="a.jpg">',
          }),
        ],
      }),
    );

    expect(r.groups[0]).toMatchObject({
      rule: 'image-alt',
      title: 'Images need a text alternative',
      kind: 'wcag',
      refs: ['WCAG 1.1.1'],
      fixable: true,
    });
  });

  it('FR-17: totals count every element by impact, and pages scanned and not scanned', () => {
    const r = buildReport(
      input({
        pages: [
          { url: SITE, error: null },
          { url: 'https://acme.test/admin', error: 'URL_NOT_ALLOWED' },
          { url: 'https://acme.test/slow', error: 'SCAN_FAILED' },
        ],
        issues: [
          issue({}),
          issue({ selector: 'nav a' }),
          issue({ ruleId: 'image-alt', impact: 'critical', actionable: true }),
        ],
      }),
    );

    expect(r.totals).toEqual({
      issues: 3,
      byImpact: { critical: 1, serious: 2, moderate: 0, minor: 0 },
      pagesScanned: 1,
      pagesNotScanned: 2,
    });
    expect(r.notScanned).toEqual([
      {
        url: 'https://acme.test/admin',
        reason: 'The address is private or not allowed, so it was not opened.',
      },
      { url: 'https://acme.test/slow', reason: 'The page could not be loaded.' },
    ]);
  });

  it('FR-17: says plainly what automated checks did not cover', () => {
    const r = buildReport(input());

    expect(r.coverage.notChecked.join(' ')).toMatch(/keyboard/i);
    expect(r.coverage.notChecked.join(' ')).toMatch(/screen reader/i);
    expect(r.coverage.notChecked.join(' ')).toMatch(/log ?in/i);
    expect(r.coverage.summary).toMatch(/human/i);
  });
});
