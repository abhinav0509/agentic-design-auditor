// URL safety (NFR-09, addendum 2.2), the in-app layer. The sandbox egress proxy (D-017) is the
// network-layer control: redirect targets and Chromium's own DNS lookups never reach page.route, so
// redirect SSRF and DNS rebinding are blocked there, not here (D-020).
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { DomainError } from '@beacon/core';
import type { BrowserContext } from 'playwright';

/** Resolves a host name to every address it answers with. Injected so tests never use real DNS. */
export type Resolver = (host: string) => Promise<string[]>;

export const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

// IPv4: everything that is not globally routable unicast.
const BLOCKED_V4 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
] as const)
  BLOCKED_V4.addSubnet(net, prefix, 'ipv4');

// IPv6: only global unicast (2000::/3), minus ranges that embed or tunnel to IPv4 or are reserved.
// Loopback, ULA (incl. Fly's fdaa::/16), link-local, multicast, IPv4-mapped and NAT64 all fall
// outside 2000::/3.
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6');
const BLOCKED_V6 = new BlockList();
BLOCKED_V6.addSubnet('2001::', 23, 'ipv6'); // IETF special purpose, incl. Teredo
BLOCKED_V6.addSubnet('2001:db8::', 32, 'ipv6'); // documentation
BLOCKED_V6.addSubnet('2002::', 16, 'ipv6'); // 6to4

function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !BLOCKED_V4.check(address, 'ipv4');
    case 6:
      return GLOBAL_V6.check(address, 'ipv6') && !BLOCKED_V6.check(address, 'ipv6');
    default:
      return false;
  }
}

const refuse = (reason: string): never => {
  throw new DomainError('URL_NOT_ALLOWED', `URL not allowed: ${reason}`);
};

/**
 * Accepts only http(s) on the default port whose host is, or resolves only to, public addresses.
 * The WHATWG parser has already turned decimal, octal, hex and short IPv4 forms into dotted quads.
 */
export async function checkUrl(
  raw: string,
  resolve: Resolver,
): Promise<{ url: string; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse('not an absolute URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') refuse(`scheme ${url.protocol}`);
  if (url.port !== '') refuse(`port ${url.port}`);

  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host !== url.hostname.replace(/^\[|\]$/g, '')) url.hostname = host;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
    refuse('internal host name');

  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await resolve(host);
    } catch {
      return refuse('host did not resolve');
    }
  }
  if (addresses.length === 0) refuse('host did not resolve');
  // Every answer must be public: a mixed answer lets the browser pick the private one.
  if (!addresses.every(isPublicAddress)) refuse('non-public address');
  return { url: url.href, addresses };
}

const guarded = new WeakMap<BrowserContext, Resolver>();

/**
 * Re-checks every request and websocket the context makes; refused ones are aborted. Register it
 * after any other routes, so it runs first and falls back to them for allowed requests.
 */
export async function guardContext(context: BrowserContext, resolve: Resolver): Promise<void> {
  const allowed = (u: string) =>
    checkUrl(u, resolve).then(
      () => true,
      () => false,
    );
  await context.route('**', async (route) =>
    (await allowed(route.request().url())) ? route.fallback() : route.abort('blockedbyclient'),
  );
  await context.routeWebSocket('**', async (ws) => {
    if (await allowed(ws.url().replace(/^ws/, 'http'))) ws.connectToServer();
    else await ws.close({ code: 1008, reason: 'blocked by egress guard' }); // 1008: policy violation
  });
  guarded.set(context, resolve);
}

/** The resolver a guarded context checks with; throws for a context without the guard. */
export function guardResolver(context: BrowserContext): Resolver {
  const resolve = guarded.get(context);
  if (!resolve) throw new Error('scan context has no egress guard: call guardContext first');
  return resolve;
}
