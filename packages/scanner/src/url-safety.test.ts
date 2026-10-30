// URL safety (NFR-09, addendum 2.2): the in-app layer. The sandbox egress proxy (D-017) is the
// network-layer control; this check rejects what it can before a browser is involved.
import { DomainError } from '@beacon/core';
import { describe, expect, it } from 'vitest';
import { checkUrl, type Resolver } from './url-safety.ts';

const PUBLIC4 = '93.184.215.14';
const PUBLIC6 = '2606:2800:21f:cb07:6820:80da:af6b:8b2c';

const DNS: Record<string, string[]> = {
  'example.com': [PUBLIC4, PUBLIC6],
  'internal.example.com': ['10.0.0.5'],
  'mixed.example.com': [PUBLIC4, '127.0.0.1'],
  'v6private.example.com': ['fd00::1'],
  'mapped.example.com': ['::ffff:169.254.169.254'],
};
const resolve: Resolver = (host) => {
  const found = DNS[host];
  return found ? Promise.resolve(found) : Promise.reject(new Error(`ENOTFOUND ${host}`));
};

const codeOf = (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: unknown) => (e instanceof DomainError ? e.code : `not a DomainError: ${String(e)}`),
  );

// The bypass corpus (addendum 2.2). Each entry must be refused.
const BYPASS = {
  scheme: [
    'file:///etc/passwd',
    'data:text/html,<h1>x</h1>',
    'javascript:alert(1)',
    'blob:https://example.com/0b0c',
    'ftp://example.com/',
    'ws://example.com/',
    'chrome://settings',
  ],
  'loopback in every spelling': [
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://0x7f000001/',
    'http://0x7f.0.0.1/',
    'http://127.1/',
    'http://0/',
    'http://0.0.0.0/',
    'http://localhost/',
    'http://localhost./',
    'http://LOCALHOST/',
    'http://app.localhost/',
    'http://[::1]/',
    'http://[0:0:0:0:0:0:0:1]/',
    'http://[::]/',
  ],
  'private, link-local and special ranges': [
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://100.64.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://198.18.0.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://[fd00::1]/',
    'http://[fdaa::3]/',
    'http://[fe80::1]/',
    'http://[ff02::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[64:ff9b::a9fe:a9fe]/',
    'http://[2002:a9fe:a9fe::]/',
    'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/',
  ],
  'parser tricks': ['http://example.com@127.0.0.1/', 'http://127.0.0.1#@example.com/'],
  'names that resolve badly': [
    'https://internal.example.com/',
    'https://mixed.example.com/',
    'https://v6private.example.com/',
    'https://mapped.example.com/',
    'https://nxdomain.example.com/',
    'http://metadata.google.internal/',
    'http://my-app.internal/',
  ],
  'ports other than 80 and 443': ['https://example.com:8443/', 'http://example.com:22/'],
  'not a url': ['', 'not a url', '//example.com/'],
};

describe('checkUrl', () => {
  for (const [group, urls] of Object.entries(BYPASS)) {
    it.each(urls)(`NFR-09: rejects ${group}: %s`, async (u) => {
      expect(await codeOf(checkUrl(u, resolve))).toBe('URL_NOT_ALLOWED');
    });
  }

  it.each([
    'https://example.com/',
    'http://example.com/a?b=1#c',
    'https://example.com:443/',
    'https://EXAMPLE.com./',
    `http://${PUBLIC4}/`,
    `http://[${PUBLIC6}]/`,
  ])('allows public http(s): %s', async (u) => {
    expect(await codeOf(checkUrl(u, resolve))).toBeUndefined();
  });

  it('returns the normalised URL and every address it checked', async () => {
    expect(await checkUrl('https://EXAMPLE.com./a', resolve)).toEqual({
      url: 'https://example.com/a',
      addresses: [PUBLIC4, PUBLIC6],
    });
  });

  it('does not ask DNS about IP literals', async () => {
    const refuse: Resolver = () => Promise.reject(new Error('resolver called'));
    expect(await checkUrl(`http://${PUBLIC4}/`, refuse)).toEqual({
      url: `http://${PUBLIC4}/`,
      addresses: [PUBLIC4],
    });
  });

  it('an empty DNS answer is refused (fail closed)', async () => {
    expect(await codeOf(checkUrl('https://example.com/', () => Promise.resolve([])))).toBe(
      'URL_NOT_ALLOWED',
    );
  });
});
