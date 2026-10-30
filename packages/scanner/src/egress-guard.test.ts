/// <reference lib="dom" />
// Egress guard (NFR-09, addendum 2.2): every request a scanned page makes is re-checked, including
// sub-resources, iframes, fetches and websockets. Defense in depth behind the sandbox proxy (D-017).
// Redirect targets and Chromium's own DNS never pass through page.route, so redirect SSRF and DNS
// rebinding are the proxy's job and are tested against it (D-020).
// Every request that gets past the guard lands in `reached`; each attack runs once unguarded as a
// control, so a test can't pass because Chromium dropped the request on its own.
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scanPage } from './scanner.ts';
import { guardContext, type Resolver } from './url-safety.ts';

const PUBLIC = '93.184.215.14';
const doc = (body: string) =>
  `<!doctype html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`;

type Served = { status?: number; headers?: Record<string, string>; body?: string };
const SERVED: Record<string, Served> = {
  'https://site.test/subresources': {
    body: doc(`
      <img src="https://site.test/ok.png" alt="ok">
      <img src="https://169.254.169.254/latest/meta-data/" alt="x">
      <iframe src="https://10.0.0.1/admin" title="x"></iframe>
      <script>
        fetch('https://[::1]/secret').catch(() => {});
        new WebSocket('wss://192.168.1.1/socket');
      </script>`),
  },
  'https://site.test/ok.png': { body: '' },
};

const PRIVATE = /169\.254\.169\.254|10\.0\.0\.1|\[::1\]|192\.168\.1\.1/;

let browser: Browser;
let reached: string[];

const resolve: Resolver = (host) =>
  host === 'site.test' ? Promise.resolve([PUBLIC]) : Promise.reject(new Error(`ENOTFOUND ${host}`));

/** A context whose "network" is SERVED, recording every request that reaches it. */
async function newContext(guarded: boolean): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const u = route.request().url();
    reached.push(u);
    const s = SERVED[u] ?? { body: 'internal data' };
    return route.fulfill({
      status: s.status ?? 200,
      headers: s.headers ?? {},
      contentType: 'text/html',
      body: s.body ?? '',
    });
  });
  await context.routeWebSocket('**', (ws) => {
    reached.push(ws.url());
    return ws.close();
  });
  if (guarded) await guardContext(context, resolve);
  return context;
}

/** Loads a page the way scanPage does, but in a context of the caller's choosing. */
async function visit(context: BrowserContext, url: string): Promise<void> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.close();
}

beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser.close();
});

beforeEach(() => {
  reached = [];
});

describe('egress guard', { timeout: 60_000 }, () => {
  it('NFR-09: scanPage refuses a context without the guard', async () => {
    const context = await newContext(false);
    await expect(scanPage(context, 'https://site.test/subresources')).rejects.toThrow(
      /egress guard/,
    );
    expect(reached).toEqual([]);
    await context.close();
  });

  it.each([
    'file:///etc/passwd',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost./',
    'http://0x7f000001/',
  ])('NFR-09: scanPage refuses to open %s', async (u) => {
    const context = await newContext(true);
    await expect(scanPage(context, u)).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
    expect(reached).toEqual([]);
    await context.close();
  });

  it('control: unguarded, the attack page does reach private addresses', async () => {
    const context = await newContext(false);
    await visit(context, 'https://site.test/subresources');
    await context.close();
    expect(reached.filter((u) => PRIVATE.test(u)).length).toBeGreaterThanOrEqual(4);
  });

  it('NFR-09: images, iframes, fetch and websockets to private addresses are blocked', async () => {
    const context = await newContext(true);
    await scanPage(context, 'https://site.test/subresources');
    await context.close();
    expect(reached).toContain('https://site.test/ok.png');
    expect(reached.filter((u) => PRIVATE.test(u))).toEqual([]);
  });

  // Need the egress proxy (D-020): page.route never sees redirect targets or Chromium's DNS.
  it.todo('NFR-09: redirect to private address rejected');
  it.todo('NFR-09: DNS rebinding blocked');
});
