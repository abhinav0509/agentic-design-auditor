/// <reference lib="dom" />
// Scan an in-memory page (demo, evals, later the verifier's re-scan). Only the page itself is served;
// every other request is aborted, so nothing on the page can reach the network.
import type { Browser } from 'playwright';
import { scanPage, type Finding } from './scanner.ts';
import { guardContext } from './url-safety.ts';

// The page is served by routing, never fetched; this stands in for a public address for the guard.
const PUBLIC = ['93.184.215.14'];

export async function scanHtml(
  browser: Browser,
  url: string,
  html: string,
): Promise<{ findings: (Finding & { elementIndex: number })[]; pageText: string }> {
  const context = await browser.newContext();
  try {
    await context.route('**/*', (route) =>
      route.request().url() === url
        ? route.fulfill({ contentType: 'text/html', body: html })
        : route.abort(),
    );
    await guardContext(context, () => Promise.resolve(PUBLIC));
    const findings = await scanPage(context, url);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    // Position of each target in document order, to find the same element in the source.
    const located = await page.evaluate(
      (targets) => {
        const all = Array.from(document.querySelectorAll('*'));
        return {
          indices: targets.map((t) => {
            const el = document.querySelector(t);
            return el ? all.indexOf(el) : -1;
          }),
          text: document.body.innerText,
        };
      },
      findings.map((f) => f.target),
    );
    return {
      findings: findings.map((f, i) => ({ ...f, elementIndex: located.indices[i] ?? -1 })),
      pageText: located.text,
    };
  } finally {
    await context.close();
  }
}
