// The source mapper (v1.0 §9.1 step 5, FR-06, D-007, D-033): a finding maps to a file and position
// only when the URL serves a repo file as-is and exactly one element matches. Never a guess.
import { buildCorpus, loadCleanPages } from '@beacon/evals';
import { scanHtml } from '@beacon/scanner';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapFinding } from './map.ts';

const ABOUT = `<!doctype html>
<html lang="en">
<head><title>About</title></head>
<body>
<main>
<h1>About the studio</h1>
<img src="/img/studio.jpg">
<p>We started with one kiln.</p>
</main>
</body>
</html>
`;
const img = { target: 'main > img', html: '<img src="/img/studio.jpg">' };
const map = (over: Partial<Parameters<typeof mapFinding>[0]> = {}): ReturnType<typeof mapFinding> =>
  mapFinding({
    files: { 'about.html': ABOUT, 'img/studio.jpg': new Uint8Array([1]) },
    pageUrl: 'https://example.com/about.html',
    served: ABOUT,
    finding: img,
    ...over,
  });

describe('mapFinding', () => {
  it('FR-06: unique match maps to the file, the start tag offset and its line', () => {
    expect(map()).toEqual({
      mapped: true,
      file: 'about.html',
      at: ABOUT.indexOf('<img'),
      line: 7,
    });
  });

  it('FR-06: the URL path maps to a file the way a static host serves it', () => {
    const files = { 'index.html': ABOUT, 'team/index.html': ABOUT, 'about.html': ABOUT };
    const fileFor = (pageUrl: string) => {
      const m = map({ files, pageUrl });
      return m.mapped ? m.file : m.reason;
    };
    expect(fileFor('https://example.com/')).toBe('index.html');
    expect(fileFor('https://example.com/about')).toBe('about.html');
    expect(fileFor('https://example.com/team/')).toBe('team/index.html');
    expect(fileFor('https://example.com/team')).toBe('team/index.html');
    expect(fileFor('https://example.com/shop?x=1#top')).toBe('no_file');
  });

  it('FR-06: ambiguous match returns unmapped, never a guess', () => {
    const twice = ABOUT.replace('<p>', '<img src="/img/studio.jpg">\n<p>');
    expect(map({ files: { 'about.html': twice }, served: twice })).toEqual({
      mapped: false,
      reason: 'ambiguous',
    });
  });

  it('FR-06: a page that is not served as-is (a build step changed it) is unmapped (D-007)', () => {
    const built = ABOUT.replace('</body>', '<script src="/analytics.js"></script>\n</body>');
    expect(map({ served: built })).toEqual({ mapped: false, reason: 'not_served_as_is' });
  });

  it('served-as-is ignores differences the HTML parser does not see', () => {
    const reformatted = ABOUT.replace('<img src="/img/studio.jpg">', "<IMG SRC='/img/studio.jpg'>");
    expect(map({ served: reformatted.replaceAll('\n', '\r\n') })).toMatchObject({ mapped: true });
  });

  it('FR-06: no matching element is unmapped', () => {
    expect(map({ finding: { target: 'img', html: '<img src="/img/other.jpg">' } })).toEqual({
      mapped: false,
      reason: 'no_match',
    });
  });

  it('a finding on <html> maps to the html start tag', () => {
    const noLang = ABOUT.replace(' lang="en"', '');
    expect(
      map({
        files: { 'about.html': noLang },
        served: noLang,
        finding: { target: 'html', html: '<html><head><title>About</title></head><body>...' },
      }),
    ).toEqual({ mapped: true, file: 'about.html', at: noLang.indexOf('<html'), line: 2 });
  });
});

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe('mapper on the mutation corpus (v1.0 §15.2)', { timeout: 120_000 }, () => {
  it('FR-06: 90%+ of findings map to the right file and line, and none map wrongly', async () => {
    const cases = buildCorpus(loadCleanPages(), 42);
    let right = 0;
    const wrong: string[] = [];
    for (const c of cases) {
      const url = `https://corpus.test/${c.truth.file}`;
      const { findings } = await scanHtml(browser, url, c.html);
      const f = findings.find((x) => x.rule_id === c.truth.rule);
      if (!f) throw new Error(`${c.id}: no finding`);
      const m = mapFinding({
        files: { [c.truth.file]: c.html },
        pageUrl: url,
        served: c.html,
        finding: f,
      });
      if (!m.mapped) continue;
      if (m.file === c.truth.file && m.line === c.truth.line) right++;
      else wrong.push(c.id);
    }
    expect(wrong).toEqual([]);
    expect(right / cases.length).toBeGreaterThanOrEqual(0.9);
  });
});
