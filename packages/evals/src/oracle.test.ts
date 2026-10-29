// A small, independent checker for the three MVP rules. It is the corpus's own ground-truth check;
// the axe-based scanner (Day 7) is measured against the corpus, not against this code.
import { describe, expect, it } from 'vitest';
import { loadCleanPages } from './corpus.ts';
import { findViolations } from './oracle.ts';

const doc = (body: string, htmlAttrs = ' lang="en"') =>
  `<!doctype html>\n<html${htmlAttrs}>\n<head><title>t</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

describe('findViolations', () => {
  it.each(loadCleanPages().map((p) => [p.id, p.html]))(
    'clean page %s has no violations',
    (_id, html) => {
      expect(findViolations(html)).toEqual([]);
    },
  );

  it('html-has-lang: a missing or empty lang', () => {
    expect(findViolations(doc('<p>x</p>', ''))).toEqual([
      { rule: 'html-has-lang', selector: 'html', line: 2 },
    ]);
    expect(findViolations(doc('<p>x</p>', ' lang=" "'))).toHaveLength(1);
  });

  it('image-alt: an img without an alt attribute; alt="" is fine', () => {
    expect(findViolations(doc('<img src="a.png" alt="">\n<img src="b.png">'))).toEqual([
      { rule: 'image-alt', selector: 'html > body > img:nth-of-type(2)', line: 6 },
    ]);
  });

  it('label: an unlabelled control', () => {
    expect(findViolations(doc('<main>\n<input type="text" name="q">\n</main>'))).toEqual([
      { rule: 'label', selector: 'html > body > main > input:nth-of-type(1)', line: 6 },
    ]);
  });

  it.each([
    '<label for="q">Q</label><input id="q">',
    '<label>Q <input name="q"></label>',
    '<input aria-label="Q">',
    '<span id="l">Q</span><input aria-labelledby="l">',
    '<input type="hidden" name="q">',
    '<input type="submit" value="Go">',
    '<input type="button" value="Go">',
    '<input type="image" src="go.png" alt="Go">',
    '<input type="reset">',
    '<select aria-label="S"><option>a</option></select>',
    '<textarea aria-label="T"></textarea>',
  ])('label: %s is labelled or exempt', (body) => {
    expect(findViolations(doc(body))).toEqual([]);
  });

  it.each([
    '<input aria-label="">',
    '<input aria-label="   ">',
    '<input aria-labelledby="missing">',
    '<label for="other">Q</label><input id="q">',
    '<select><option>a</option></select>',
    '<textarea></textarea>',
  ])('label: %s is a violation', (body) => {
    expect(findViolations(doc(body)).map((v) => v.rule)).toEqual(['label']);
  });

  it('reports violations in document order', () => {
    const html = doc('<img src="a.png">\n<input name="q">', '');
    expect(findViolations(html).map((v) => v.rule)).toEqual([
      'html-has-lang',
      'image-alt',
      'label',
    ]);
  });
});
