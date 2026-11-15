export type OwnershipResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_EMAIL' | 'INVALID_SITE' | 'FREE_MAIL' | 'DOMAIN_MISMATCH' };

export function emailProvesSite(_email: string, _siteUrl: string): OwnershipResult {
  return { ok: false, reason: 'INVALID_EMAIL' };
}
