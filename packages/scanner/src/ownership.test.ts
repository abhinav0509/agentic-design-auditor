// Proving control of a site (FR-04, FR-04a, D-060): a DNS TXT record, a meta tag on the page, or a
// well-known file, each carrying the site's token. Page and file checks go through the same guarded
// browser context as scans, so verification cannot reach a private address either.
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyOwnership } from './ownership.ts';
import { guardContext } from './url-safety.ts';

const TOKEN = 'bv_4f1c2a9d8e7b6c5a';
const PAGES: Record<string, string> = {
  'https://meta.test/': `<!doctype html><html lang="en"><head><meta name="beacon-verification" content="${TOKEN}"><title>t</title></head><body>Hi</body></html>`,
  'https://file.test/':
    '<!doctype html><html lang="en"><head><title>t</title></head><body>Hi</body></html>',
  'https://file.test/.well-known/beacon-verification.txt': `${TOKEN}\n`,
  'https://none.test/':
    '<!doctype html><html lang="en"><head><meta name="beacon-verification" content="someone-else"><title>t</title></head><body>Hi</body></html>',
};
const TXT: Record<string, string[][]> = {
  'dns.test': [['v=spf1 -all'], [`beacon-verify=${TOKEN}`]],
};
const resolveTxt = (host: string) => Promise.resolve(TXT[host] ?? []);

let browser: Browser;
let context: BrowserContext;
beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext();
  await context.route('**/*', (route) => {
    const body = PAGES[route.request().url()];
    return body === undefined
      ? route.fulfill({ status: 404, body: '' })
      : route.fulfill({
          contentType: route.request().url().endsWith('.txt') ? 'text/plain' : 'text/html',
          body,
        });
  });
  await guardContext(context, (host) =>
    Promise.resolve(host === 'internal.test' ? ['10.0.0.5'] : ['93.184.215.14']),
  );
}, 60_000);
afterAll(async () => {
  await browser.close();
});

describe('verifyOwnership', () => {
  it.each([
    ['https://dns.test/', 'dns_txt'],
    ['https://meta.test/', 'meta_tag'],
    ['https://file.test/', 'well_known_file'],
  ])('FR-04a: %s proves control by %s', async (siteUrl, method) => {
    expect(await verifyOwnership({ context, resolveTxt }, { siteUrl, token: TOKEN })).toEqual({
      ok: true,
      method,
    });
  });

  it('FR-04: a site with another token, or none, is not proven', async () => {
    expect(
      await verifyOwnership(
        { context, resolveTxt },
        { siteUrl: 'https://none.test/', token: TOKEN },
      ),
    ).toEqual({ ok: false });
  });

  it('NFR-09: verification never fetches a private address', async () => {
    expect(
      await verifyOwnership(
        { context, resolveTxt },
        { siteUrl: 'https://internal.test/', token: TOKEN },
      ),
    ).toEqual({ ok: false });
  });

  it('FR-04a: a token must be a Beacon token, so a short or empty one never matches', async () => {
    await expect(
      verifyOwnership({ context, resolveTxt }, { siteUrl: 'https://dns.test/', token: '' }),
    ).rejects.toThrow(/token/);
  });
});
