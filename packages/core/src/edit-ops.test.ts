// Edit ops (addendum A.1, D-009): the agent names an element and an attribute; our code writes the
// bytes. Only the target start tag may change, and values can never break out of the attribute.
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { describe, expect, it } from 'vitest';
import { applyEditOps } from './edit-ops.ts';
import { DomainError } from './errors.ts';
import { catchError } from './test-helpers.ts';

type Element = DefaultTreeAdapterMap['element'];

const page = readFileSync(new URL('./__fixtures__/page.html', import.meta.url), 'utf8');
const at = (snippet: string) => {
  const i = page.indexOf(snippet);
  if (i < 0) throw new Error(`fixture lacks ${snippet}`);
  return i;
};

const elements = (html: string): Element[] => {
  const out: Element[] = [];
  const walk = (n: { childNodes?: unknown[] }) => {
    if ('tagName' in n) out.push(n as Element);
    for (const c of n.childNodes ?? []) walk(c as { childNodes?: unknown[] });
  };
  walk(parse(html));
  return out;
};

describe('applyEditOps', () => {
  it('inserts a new attribute at the end of the target start tag and changes nothing else', () => {
    const after = applyEditOps(page, [
      {
        op: 'set_attr',
        at: at('<img src="hero.jpg">'),
        name: 'alt',
        value: 'Founder holding the product',
      },
    ]);
    expect(after).toBe(
      page.replace(
        '<img src="hero.jpg">',
        '<img src="hero.jpg" alt="Founder holding the product">',
      ),
    );
  });

  it('replaces an existing attribute value in place', () => {
    const after = applyEditOps(page, [
      { op: 'set_attr', at: at('<img src="logo.png"'), name: 'alt', value: 'Shop logo' },
    ]);
    expect(after).toBe(
      page.replace('<img src="logo.png" alt="">', '<img src="logo.png" alt="Shop logo">'),
    );
  });

  it('inserts before the slash of a self-closing tag', () => {
    const after = applyEditOps(page, [
      { op: 'set_attr', at: at('<input type="text"'), name: 'aria-label', value: 'Nickname' },
    ]);
    expect(after).toBe(
      page.replace(
        '<input type="text" name="nick" />',
        '<input type="text" name="nick" aria-label="Nickname" />',
      ),
    );
  });

  it('removes an attribute together with its leading whitespace', () => {
    const after = applyEditOps(page, [
      { op: 'remove_attr', at: at('<img src="logo.png"'), name: 'alt' },
    ]);
    expect(after).toBe(page.replace('<img src="logo.png" alt="">', '<img src="logo.png">'));
  });

  it('applies several ops in one file regardless of the order given', () => {
    const ops = [
      { op: 'set_attr', at: at('<html>'), name: 'lang', value: 'en' },
      { op: 'set_attr', at: at('<img src="hero.jpg">'), name: 'alt', value: 'Hero' },
    ] as const;
    const expected = page
      .replace('<html>', '<html lang="en">')
      .replace('<img src="hero.jpg">', '<img src="hero.jpg" alt="Hero">');
    expect(applyEditOps(page, [...ops])).toBe(expected);
    expect(applyEditOps(page, [...ops].reverse())).toBe(expected);
  });

  it('escapes quotes, ampersands and angle brackets in values', () => {
    const after = applyEditOps(page, [
      {
        op: 'set_attr',
        at: at('<img src="hero.jpg">'),
        name: 'alt',
        value: '"><script>x</script> & co',
      },
    ]);
    expect(after).toContain('alt="&quot;&gt;&lt;script&gt;x&lt;/script&gt; &amp; co"');
  });

  it('property: no value can break out of the attribute', () => {
    const before = elements(page).map((e) => e.tagName);
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }).filter((s) => !/[\0\r]/.test(s)), // parse5 normalises these two
        (value) => {
          const after = applyEditOps(page, [
            { op: 'set_attr', at: at('<img src="hero.jpg">'), name: 'alt', value },
          ]);
          const els = elements(after);
          expect(els.map((e) => e.tagName)).toEqual(before);
          const hero = els.find((e) => e.attrs.some((a) => a.value === 'hero.jpg'));
          expect(hero?.attrs).toEqual([
            { name: 'src', value: 'hero.jpg' },
            { name: 'alt', value },
          ]);
        },
      ),
    );
  });

  it('throws EDIT_TARGET_NOT_FOUND when no start tag begins at the offset', () => {
    const error = catchError(() =>
      applyEditOps(page, [
        { op: 'set_attr', at: at('<img src="hero.jpg">') + 1, name: 'alt', value: 'x' },
      ]),
    );
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('EDIT_TARGET_NOT_FOUND');
  });
});
