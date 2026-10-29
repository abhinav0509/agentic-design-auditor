// Patch guard (v1.0 §9.3, addendum A.2): pure code, security critical. Compares parsed trees, not
// lines, so a change is accepted only if it is exactly an allowed attribute edit for the rule.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import hostile from './__fixtures__/hostile-html.json' with { type: 'json' };
import { applyEditOps } from './edit-ops.ts';
import { guard, type GuardReason } from './guard.ts';

const page = readFileSync(new URL('./__fixtures__/page.html', import.meta.url), 'utf8');
const hash = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

const check = (ruleId: string, after: string, before = page) =>
  guard({ ruleId, baseHash: hash(before), files: [{ path: 'index.html', before, after }] });
const edit = (from: string, to: string) => {
  if (!page.includes(from)) throw new Error(`fixture lacks ${from}`);
  return page.replace(from, to);
};
const rejects = (result: ReturnType<typeof guard>, reason: GuardReason) => {
  expect(result.ok).toBe(false);
  expect(result.reasons).toContain(reason);
};

const HERO = '<img src="hero.jpg">';
const withAlt = (alt: string) => edit(HERO, `<img src="hero.jpg" alt="${alt}">`);

describe('guard accepts allowed edits', () => {
  it.each([
    ['image-alt', withAlt('Founder holding the product')],
    ['image-alt', edit('<img src="logo.png" alt="">', '<img src="logo.png" alt="Shop logo">')],
    ['image-alt', withAlt('')],
    ['html-has-lang', edit('<html>', '<html lang="en-GB">')],
    [
      'label',
      edit('<input type="search" name="q">', '<input type="search" name="q" aria-label="Search">'),
    ],
    [
      'label',
      edit(
        '<input type="search" name="q">',
        '<input type="search" name="q" aria-labelledby="search-label">',
      ),
    ],
    ['label', edit('<label>Email</label>', '<label for="email">Email</label>')],
  ])('%s: %#', (ruleId, after) => {
    expect(check(ruleId, after)).toEqual({ ok: true, reasons: [] });
  });

  it('ignores parse errors the page already had', () => {
    const broken = page.replace('</main>', '</p></main>'); // stray end tag: a pre-existing parse error
    const after = broken.replace(HERO, '<img src="hero.jpg" alt="Hero">');
    expect(check('image-alt', after, broken)).toEqual({ ok: true, reasons: [] });
  });
});

describe('guard rejects, one reason code each', () => {
  it('UNKNOWN_RULE: a rule outside the verified set', () => {
    rejects(check('color-contrast', withAlt('x')), 'UNKNOWN_RULE');
  });

  it('BASE_MISMATCH: before does not match the base hash', () => {
    const result = guard({
      ruleId: 'image-alt',
      baseHash: hash('something else'),
      files: [{ path: 'index.html', before: page, after: withAlt('x') }],
    });
    rejects(result, 'BASE_MISMATCH');
  });

  it('MULTI_FILE: more than one file', () => {
    const file = { path: 'index.html', before: page, after: withAlt('x') };
    rejects(
      guard({
        ruleId: 'image-alt',
        baseHash: hash(page),
        files: [file, { ...file, path: 'b.html' }],
      }),
      'MULTI_FILE',
    );
  });

  it.each(['../etc/passwd', '/abs/index.html', 'a/../../b.html', 'C:\\x.html', ''])(
    'PATH_INVALID: %j',
    (path) => {
      const result = guard({
        ruleId: 'image-alt',
        baseHash: hash(page),
        files: [{ path, before: page, after: withAlt('x') }],
      });
      rejects(result, 'PATH_INVALID');
    },
  );

  it('EMPTY_PATCH: nothing changed', () => {
    rejects(check('image-alt', page), 'EMPTY_PATCH');
  });

  it.each([
    '<script>alert(1)</script>',
    '<iframe src="https://evil.example"></iframe>',
    '<style>body{display:none}</style>',
  ])('FORBIDDEN_ELEMENT: adds %s', (snippet) => {
    rejects(check('image-alt', edit('</main>', `${snippet}</main>`)), 'FORBIDDEN_ELEMENT');
  });

  it('STRUCTURE_CHANGED: removes an element', () => {
    rejects(check('image-alt', edit('<img src="logo.png" alt="">\n', '')), 'STRUCTURE_CHANGED');
  });

  it('STRUCTURE_CHANGED: reorders elements', () => {
    const swapped = edit(
      '<img src="hero.jpg">\n<img src="logo.png" alt="">',
      '<img src="logo.png" alt="">\n<img src="hero.jpg">',
    );
    rejects(check('image-alt', swapped), 'STRUCTURE_CHANGED');
  });

  it('TEXT_CHANGED: edits visible text', () => {
    rejects(check('image-alt', edit('<h1>Welcome</h1>', '<h1>Welcome!</h1>')), 'TEXT_CHANGED');
  });

  it.each([
    ['image-alt', edit(HERO, '<img src="evil.jpg">')],
    ['image-alt', edit('<html>', '<html lang="en">')],
    ['html-has-lang', withAlt('x')],
    ['html-has-lang', edit('<body>', '<body lang="en">')],
    ['label', withAlt('x')],
    ['label', edit(HERO, '<img src="hero.jpg" aria-label="x">')],
    ['image-alt', edit(HERO, '<img src="hero.jpg" style="display:none">')],
  ])('ATTRIBUTE_NOT_ALLOWED: %s %#', (ruleId, after) => {
    rejects(check(ruleId, after), 'ATTRIBUTE_NOT_ALLOWED');
  });

  it('EVENT_HANDLER: adds an on* attribute', () => {
    rejects(
      check('image-alt', edit(HERO, '<img src="hero.jpg" alt="x" onerror="alert(1)">')),
      'EVENT_HANDLER',
    );
  });

  it.each([
    ['image-alt', withAlt('&lt;b&gt;bold&lt;/b&gt;')],
    ['image-alt', withAlt('javascript:alert(1)')],
    ['image-alt', withAlt('see https://evil.example')],
    ['image-alt', withAlt('data:text/html,hi')],
    ['image-alt', withAlt('Sale \u202Eitem')],
    ['image-alt', withAlt('bell\u0007')],
    ['image-alt', withAlt('a'.repeat(251))],
    [
      'label',
      edit(
        '<input type="search" name="q">',
        `<input type="search" name="q" aria-label="${'a'.repeat(121)}">`,
      ),
    ],
    ['html-has-lang', edit('<html>', '<html lang="english language">')],
    [
      'label',
      edit('<input type="search" name="q">', '<input type="search" name="q" id="1bad id">'),
    ],
  ])('VALUE_UNSAFE: %s %#', (ruleId, after) => {
    rejects(check(ruleId, after), 'VALUE_UNSAFE');
  });

  it('DUPLICATE_ID: adds an id that already exists', () => {
    rejects(
      check(
        'label',
        edit('<input type="search" name="q">', '<input type="search" name="q" id="email">'),
      ),
      'DUPLICATE_ID',
    );
  });

  it.each([
    edit('<input type="search" name="q">', '<input type="search" name="q" aria-labelledby="nope">'),
    edit('<label>Email</label>', '<label for="missing">Email</label>'),
  ])('DANGLING_REFERENCE: %#', (after) => {
    rejects(check('label', after), 'DANGLING_REFERENCE');
  });

  it('INVALID_HTML: introduces a new parse error', () => {
    rejects(check('image-alt', edit(HERO, '<img src="hero.jpg" alt="x"">')), 'INVALID_HTML');
  });

  it('PATCH_TOO_LARGE: more than 30 changed lines', () => {
    const many = Array.from({ length: 31 }, (_, i) => `<img src="${String(i)}.png">`).join('\n');
    const before = page.replace('</main>', `${many}\n</main>`);
    const after = before.replace(/<img src="(\d+)\.png">/g, '<img src="$1.png" alt="x">');
    rejects(check('image-alt', after, before), 'PATCH_TOO_LARGE');
  });

  it('reports every reason, sorted and without duplicates', () => {
    const after = edit('</main>', '<script>1</script><script>2</script></main>').replace(
      HERO,
      '<img src="hero.jpg" onerror="x">',
    );
    const { reasons } = check('image-alt', after);
    expect(reasons).toEqual([...new Set(reasons)].sort());
    expect(reasons).toEqual(expect.arrayContaining(['EVENT_HANDLER', 'FORBIDDEN_ELEMENT']));
  });
});

describe('guard fuzzing', () => {
  const lines = page.split('\n');

  it('property: inserting any hostile snippet at any line is rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...hostile),
        fc.integer({ min: 0, max: lines.length - 1 }),
        fc.constantFrom('image-alt', 'html-has-lang', 'label'),
        (snippet, line, ruleId) => {
          const after = [...lines.slice(0, line), snippet, ...lines.slice(line)].join('\n');
          expect(check(ruleId, after).ok).toBe(false);
        },
      ),
    );
  });

  it('property: an alt edit through applyEditOps can only ever fail on its value', () => {
    const allowedFailures = new Set<GuardReason>(['VALUE_UNSAFE']);
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary' }).filter((s) => !/[\0\r]/.test(s)),
        (value) => {
          const after = applyEditOps(page, [
            { op: 'set_attr', at: page.indexOf(HERO), name: 'alt', value },
          ]);
          const { reasons } = check('image-alt', after);
          for (const r of reasons) expect(allowedFailures).toContain(r);
        },
      ),
    );
  });
});
