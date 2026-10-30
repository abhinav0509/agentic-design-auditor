// Fingerprinting and dedupe (v1.0 §9.1 steps 3-4, §16.4): fingerprint = rule + normalised selector
// + snippet hash, so a template violation repeated across pages becomes one finding.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dedupeFindings, fingerprint, type RawFinding } from './fingerprint.ts';

const raw = (overrides: Partial<RawFinding> = {}): RawFinding => ({
  page_url: 'https://example.com/',
  rule_id: 'image-alt',
  impact: 'critical',
  target: 'header > img',
  html: '<img src="/logo.png" class="logo">',
  ...overrides,
});

describe('fingerprint', () => {
  it('is a stable hex digest', () => {
    expect(fingerprint(raw())).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(raw())).toBe(fingerprint(raw()));
  });

  it('formatting-only differences do not change the fingerprint', () => {
    const variants = [
      raw({ html: '<IMG class="logo"   src="/logo.png">' }),
      raw({ html: '<img\n  src="/logo.png"\n  class="logo"\n/>' }),
      raw({ target: '  header >   img ' }),
    ];
    for (const v of variants) expect(fingerprint(v)).toBe(fingerprint(raw()));
  });

  it('whitespace runs inside text are formatting', () => {
    const a = raw({
      rule_id: 'label',
      target: 'form > input',
      html: '<label>First  name\n</label>',
    });
    const b = raw({ rule_id: 'label', target: 'form > input', html: '<label>First name</label>' });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('attribute order never changes the fingerprint (property)', () => {
    const attrs: [string, string][] = [
      ['src', '/logo.png'],
      ['class', 'logo'],
      ['width', '120'],
      ['data-x', 'y'],
    ];
    fc.assert(
      fc.property(fc.shuffledSubarray(attrs, { minLength: 4, maxLength: 4 }), (order) => {
        const html = `<img ${order.map(([k, v]) => `${k}="${v}"`).join(' ')}>`;
        const sorted = `<img ${attrs.map(([k, v]) => `${k}="${v}"`).join(' ')}>`;
        expect(fingerprint(raw({ html }))).toBe(fingerprint(raw({ html: sorted })));
      }),
    );
  });

  it('rule, selector and snippet content each change the fingerprint', () => {
    const base = fingerprint(raw());
    expect(fingerprint(raw({ rule_id: 'label' }))).not.toBe(base);
    expect(fingerprint(raw({ target: 'footer > img' }))).not.toBe(base);
    expect(fingerprint(raw({ html: '<img src="/other.png" class="logo">' }))).not.toBe(base);
    expect(fingerprint(raw({ html: '<img src="/logo.png" class="Logo">' }))).not.toBe(base);
  });

  it('ignores page url and impact (same violation, many pages)', () => {
    expect(fingerprint(raw({ page_url: 'https://example.com/about', impact: 'serious' }))).toBe(
      fingerprint(raw()),
    );
  });
});

describe('dedupeFindings', () => {
  it('same violation on many pages yields one finding with many occurrences', () => {
    const pages = ['/', '/about', '/contact'].map((p) => `https://example.com${p}`);
    const found = dedupeFindings(pages.map((page_url) => raw({ page_url })));

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      fingerprint: fingerprint(raw()),
      rule_id: 'image-alt',
      impact: 'critical',
      selector: 'header > img',
      html: '<img src="/logo.png" class="logo">',
      occurrences: pages,
    });
  });

  it('keeps distinct violations apart, in first-seen order', () => {
    const logo = raw();
    const hero = raw({ target: 'main > img', html: '<img src="/hero.jpg">' });
    const found = dedupeFindings([logo, hero, raw({ page_url: 'https://example.com/b' })]);

    expect(found.map((f) => f.selector)).toEqual(['header > img', 'main > img']);
    expect(found.map((f) => f.occurrences.length)).toEqual([2, 1]);
  });

  it('a page is listed once even if reported twice', () => {
    expect(dedupeFindings([raw(), raw()])[0]?.occurrences).toEqual(['https://example.com/']);
  });

  it('empty in, empty out', () => {
    expect(dedupeFindings([])).toEqual([]);
  });
});
