// Proving control of a site (FR-04, FR-04a, addendum 2.1, D-060): the site carries its Beacon token
// in one of three places. DNS is checked first (no request to the site), then a meta tag on the page,
// then /.well-known/beacon-verification.txt. Page and file fetches pass checkUrl and run in the
// caller's guarded browser context (D-017, D-020), so verification can never reach a private address.
import type { BrowserContext, Page } from 'playwright';
import { checkUrl, guardResolver } from './url-safety.ts';

export type OwnershipMethod = 'dns_txt' | 'meta_tag' | 'well_known_file';

const TOKEN = /^bv_[a-z0-9]{16,64}$/;
const TIMEOUT_MS = 15_000;

async function pageText(
  context: BrowserContext,
  url: string,
): Promise<{ status: number; page: Page } | null> {
  try {
    await checkUrl(url, guardResolver(context));
  } catch {
    return null; // a private or disallowed address is simply not a proof
  }
  const page = await context.newPage();
  const res = await page.goto(url, { timeout: TIMEOUT_MS }).catch(() => null);
  if (!res) {
    await page.close();
    return null;
  }
  return { status: res.status(), page };
}

export async function verifyOwnership(
  deps: { context: BrowserContext; resolveTxt: (host: string) => Promise<string[][]> },
  { siteUrl, token }: { siteUrl: string; token: string },
): Promise<{ ok: true; method: OwnershipMethod } | { ok: false }> {
  if (!TOKEN.test(token)) throw new Error('not a Beacon verification token');
  const site = new URL(siteUrl);

  const records = await deps.resolveTxt(site.hostname).catch(() => []);
  if (records.some((chunks) => chunks.join('') === `beacon-verify=${token}`))
    return { ok: true, method: 'dns_txt' };

  const home = await pageText(deps.context, site.href);
  if (home) {
    try {
      const tags = await home.page
        .locator('meta[name="beacon-verification"]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('content')));
      if (home.status === 200 && tags.includes(token)) return { ok: true, method: 'meta_tag' };
    } finally {
      await home.page.close();
    }
  }

  const file = await pageText(
    deps.context,
    new URL('/.well-known/beacon-verification.txt', site).href,
  );
  if (file) {
    try {
      const text = (await file.page.evaluate(() => document.body.innerText)).trim();
      if (file.status === 200 && text === token) return { ok: true, method: 'well_known_file' };
    } finally {
      await file.page.close();
    }
  }
  return { ok: false };
}
