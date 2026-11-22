import type { BrowserContext } from 'playwright';
export type OwnershipMethod = 'dns_txt' | 'meta_tag' | 'well_known_file';
export function verifyOwnership(
  _d: { context: BrowserContext; resolveTxt: (host: string) => Promise<string[][]> },
  _i: { siteUrl: string; token: string },
): Promise<{ ok: true; method: OwnershipMethod } | { ok: false }> {
  return Promise.reject(new Error('not implemented'));
}
