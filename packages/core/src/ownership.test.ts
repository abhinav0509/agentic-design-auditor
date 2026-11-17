import { describe, expect, it } from 'vitest';
import { emailProvesSite } from './ownership.ts';

describe('emailProvesSite', () => {
  it.each([
    ['jo@acme.com', 'https://acme.com/'],
    ['jo@acme.com', 'https://www.acme.com/about'],
    ['JO@ACME.COM', 'https://Acme.com'],
    ['jo@acme.com.', 'https://acme.com./'],
    ['jo@bücher.de', 'https://xn--bcher-kva.de/'],
  ])('FR-30: %s proves %s', (email, site) => {
    expect(emailProvesSite(email, site)).toEqual({ ok: true });
  });

  it.each([
    ['jo@acme.com', 'https://acme.com.evil.com/'],
    ['jo@acme.com.evil.com', 'https://acme.com/'],
    ['jo@evil.com', 'https://acme.com/'],
    // Shared hosting: one provider's staff must not prove every customer site.
    ['jo@github.io', 'https://victim.github.io/'],
    ['jo@vercel.app', 'https://victim.vercel.app/'],
    // shortcut: subdomains need the Public Suffix List to be safe; exact host or www only for now.
    ['jo@acme.com', 'https://shop.acme.com/'],
  ])('FR-30: %s does not prove %s', (email, site) => {
    expect(emailProvesSite(email, site)).toEqual({ ok: false, reason: 'DOMAIN_MISMATCH' });
  });

  it.each(['jo@gmail.com', 'jo@outlook.com', 'jo@icloud.com', 'jo@proton.me'])(
    'FR-30: a free-mail address (%s) never proves a site, even its own',
    (email) => {
      const site = `https://${email.split('@')[1] ?? ''}/`;
      expect(emailProvesSite(email, site)).toEqual({ ok: false, reason: 'FREE_MAIL' });
    },
  );

  it.each([
    'jo',
    'jo@',
    '@acme.com',
    'a@b@acme.com',
    'jo@acme.com/x',
    'jo@acme .com',
    'jo@acme.com#',
  ])('FR-30: refuses a malformed email (%j)', (email) => {
    expect(emailProvesSite(email, 'https://acme.com/')).toEqual({
      ok: false,
      reason: 'INVALID_EMAIL',
    });
  });

  it.each(['ftp://acme.com/', 'https://93.184.215.14/', 'https://[::1]/', 'not a url'])(
    'FR-30: refuses a site that is not an http(s) domain (%j)',
    (site) => {
      expect(emailProvesSite('jo@acme.com', site)).toEqual({ ok: false, reason: 'INVALID_SITE' });
    },
  );
});
