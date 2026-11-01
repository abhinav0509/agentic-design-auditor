// scanHtml: scan an in-memory page with every other request aborted (demo, evals, later the verifier).
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanHtml } from './scan-html.ts';

const doc = (body: string) =>
  `<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe('scanHtml', { timeout: 60_000 }, () => {
  it('finds violations and gives each one the element position in document order', async () => {
    const html = doc('<main><p>Hello team</p><img src="a.png" alt="ok"><img src="b.png"></main>');
    const { findings, pageText } = await scanHtml(browser, 'https://corpus.test/p.html', html);
    expect(findings).toMatchObject([{ rule_id: 'image-alt', html: '<img src="b.png">' }]);
    // html, head, title, body, main, p, img, img
    expect(findings[0]?.elementIndex).toBe(7);
    expect(pageText).toContain('Hello team');
  });

  it('a clean page has no findings', async () => {
    const { findings } = await scanHtml(browser, 'https://corpus.test/c.html', doc('<p>fine</p>'));
    expect(findings).toEqual([]);
  });

  it('NFR-09: nothing but the page itself is fetched', async () => {
    const html = doc(
      `<p id="out">waiting</p><script>fetch('https://corpus.test/other').then(() => { out.textContent = 'LEAKED'; }, () => { out.textContent = 'BLOCKED'; });</script>`,
    );
    const { pageText } = await scanHtml(browser, 'https://corpus.test/f.html', html);
    expect(pageText).toContain('BLOCKED');
  });
});
