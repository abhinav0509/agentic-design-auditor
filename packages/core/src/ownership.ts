// Report-tier ownership (FR-30, D-041, addendum 2.1): a verified email on the site's own domain
// proves affiliation for a capped URL-only report, never for fixes. Sending and checking the
// verification email is the sign-in flow's job; this decides only whether the domain counts.

export type OwnershipResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID_EMAIL' | 'INVALID_SITE' | 'FREE_MAIL' | 'DOMAIN_MISMATCH' };

// shortcut: the large consumer providers only; extend it when a pilot shows another one.
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'mail.com', 'yandex.com',
  'yandex.ru', 'mail.ru', 'qq.com', '163.com', '126.com', 'zoho.com', 'fastmail.com', 'hey.com',
]); // prettier-ignore

/** A domain name in ASCII (IDNA) form without a trailing dot, or null when it is not one. */
function asciiDomain(name: string): string | null {
  if (!/^[\p{L}\p{N}.-]+$/u.test(name)) return null;
  let host: string;
  try {
    host = new URL(`http://${name}/`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '');
  if (!host.includes('.') || /^[\d.]+$/.test(host)) return null; // a name, not an IP address
  return host;
}

function siteHost(siteUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return asciiDomain(url.hostname);
}

export function emailProvesSite(email: string, siteUrl: string): OwnershipResult {
  const parts = email.split('@');
  const domain = parts.length === 2 && parts[0] !== '' ? asciiDomain(parts[1] ?? '') : null;
  if (domain === null) return { ok: false, reason: 'INVALID_EMAIL' };
  const host = siteHost(siteUrl);
  if (host === null) return { ok: false, reason: 'INVALID_SITE' };
  if (FREE_MAIL.has(domain)) return { ok: false, reason: 'FREE_MAIL' };
  // shortcut: exact host or www only. Allowing other subdomains safely needs the Public Suffix List
  // (else a github.io address proves every *.github.io site); add it with that dependency.
  return host === domain || host === `www.${domain}`
    ? { ok: true }
    : { ok: false, reason: 'DOMAIN_MISMATCH' };
}
