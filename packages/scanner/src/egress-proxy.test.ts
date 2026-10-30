/// <reference lib="dom" />
// Egress proxy (NFR-09, D-017, D-021): Chromium launched with the sandbox options sends every
// request through Smokescreen, which resolves each name itself and refuses non-public addresses.
// This covers what the in-app guard cannot see (D-020): redirect targets, DNS rebinding, loopback
// and WebRTC. Where Chromium can run the attack without the protection, that runs as a control.
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  freePort,
  startDns,
  startServer,
  startSmokescreen,
  startUdpSink,
  type Decision,
} from './proxy-harness.ts';
import { chromiumLaunchOptions } from './sandbox.ts';

type Server = Awaited<ReturnType<typeof startServer>>;
type Dns = Awaited<ReturnType<typeof startDns>>;
type Proxy = Awaited<ReturnType<typeof startSmokescreen>>;
type Sink = Awaited<ReturnType<typeof startUdpSink>>;

let P: number; // the public port; "public" is 127.0.0.1:P only
let publicSite: Server; // 127.0.0.1:P, allow-listed
let privateV6: Server; // [::1]:P, same port, so a rebound name lands here
let privateV4: Server; // 127.0.0.1:Q, not allow-listed
let stun: Sink; // UDP on 127.0.0.1
let dns: Dns;
let proxy: Proxy;
let sandboxed: Browser;
let rebound = false;

const html = (body: string) => `<!doctype html><html lang="en"><title>t</title>${body}</html>`;

function pages(path: string, res: import('node:http').ServerResponse): void {
  const send = (body: string): void => {
    res.setHeader('content-type', 'text/html').end(html(body));
  };
  switch (path) {
    case '/redirect':
      res.writeHead(302, { location: `http://[::1]:${String(P)}/secret` }).end();
      return;
    case '/redirect-sub': {
      send('<img src="/redirect" alt="">');
      return;
    }
    case '/rebind':
      rebound = true; // TTL-0 flip: from now on rebind.test answers with ::1
      {
        send(`<script>fetch('/data').catch(() => {});</script>`);
        return;
      }
    case '/targets': {
      send(
        [
          'http://169.254.169.254/latest/meta-data/',
          'http://10.0.0.1/',
          'http://100.64.0.1/',
          'http://[fd00::1]/',
          `http://app.internal:${String(P)}/`,
        ]
          .map((u) => `<iframe src="${u}" title="x"></iframe>`)
          .join(''),
      );
      return;
    }
    case '/loopback': {
      send(
        `<script>fetch('http://127.0.0.1:${String(privatePortV4)}/secret').catch(() => {});</script>`,
      );
      return;
    }
    case '/webrtc': {
      send(`<script>
        window.gathered = (async () => {
          const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${String(stun.port)}' }] });
          pc.createDataChannel('x');
          await pc.setLocalDescription(await pc.createOffer());
          await new Promise((done) => {
            pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && done();
            setTimeout(done, 3000);
          });
        })();
      </script>`);
      return;
    }
    default:
      res.end('public data');
  }
}
let privatePortV4: number;

async function visit(browser: Browser, url: string, wait?: string): Promise<void> {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 }).catch(() => undefined);
  if (wait) await page.evaluate(wait).catch(() => undefined);
  await page.close();
}

const denied = (d: Decision[], host: string) =>
  d.some((x) => !x.allow && x.requested_host === host);

async function withBrowser(options: LaunchOptions, fn: (b: Browser) => Promise<void>) {
  const browser = await chromium.launch(options);
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

beforeAll(async () => {
  P = await freePort('127.0.0.1');
  publicSite = await startServer('127.0.0.1', P, pages);
  privateV6 = await startServer('::1', P);
  privatePortV4 = await freePort('127.0.0.1');
  privateV4 = await startServer('127.0.0.1', privatePortV4);
  stun = await startUdpSink('127.0.0.1');
  dns = await startDns((name) => {
    if (name === 'site.test') return { a: ['127.0.0.1'] };
    if (name === 'rebind.test') return rebound ? { aaaa: ['::1'] } : { a: ['127.0.0.1'] };
    if (name === 'app.internal') return { aaaa: ['fdaa::3'] };
    return undefined;
  });
  proxy = await startSmokescreen([
    '--resolver-address',
    dns.address,
    '--allow-address',
    `127.0.0.1:${String(P)}`, // the test's stand-in for the public internet
  ]);
  sandboxed = await chromium.launch(chromiumLaunchOptions(proxy.url));
}, 60_000);

afterAll(async () => {
  await sandboxed.close();
  await proxy.close();
  await Promise.all([publicSite.close(), privateV6.close(), privateV4.close(), stun.close()]);
  await dns.close();
});

beforeEach(() => {
  rebound = false;
  for (const s of [publicSite, privateV6, privateV4]) s.hits.length = 0;
  proxy.decisions.length = 0;
});

describe('egress proxy', { timeout: 60_000 }, () => {
  it('serves the public site through the proxy', async () => {
    await visit(sandboxed, `http://site.test:${String(P)}/hello`);
    expect(publicSite.hits).toContain('/hello');
  });

  it('control: without the proxy, Chromium follows a redirect to a private address', async () => {
    await withBrowser({}, (b) => visit(b, `http://127.0.0.1:${String(P)}/redirect-sub`));
    expect(privateV6.hits).toContain('/secret');
  });

  it('NFR-09: redirect to private address rejected', async () => {
    await visit(sandboxed, `http://site.test:${String(P)}/redirect-sub`);
    await visit(sandboxed, `http://site.test:${String(P)}/redirect`);
    expect(publicSite.hits.filter((h) => h === '/redirect')).toHaveLength(2);
    expect(privateV6.hits).toEqual([]);
    expect(denied(proxy.decisions, `[::1]:${String(P)}`)).toBe(true);
  });

  it('NFR-09: DNS rebinding blocked', async () => {
    await visit(sandboxed, `http://rebind.test:${String(P)}/rebind`);
    expect(publicSite.hits).toContain('/rebind');
    expect(publicSite.hits).not.toContain('/data');
    expect(privateV6.hits).toEqual([]);
    // The proxy asked DNS again after the flip and refused the private answer.
    expect(dns.queries.filter((q) => q.startsWith('rebind.test')).length).toBeGreaterThan(1);
    expect(denied(proxy.decisions, `rebind.test:${String(P)}`)).toBe(true);
  });

  it('NFR-09: the metadata IP, private ranges and the Fly private network are refused', async () => {
    await visit(sandboxed, `http://site.test:${String(P)}/targets`);
    for (const host of [
      '169.254.169.254',
      '10.0.0.1',
      '100.64.0.1',
      '[fd00::1]',
      `app.internal:${String(P)}`,
    ])
      expect(denied(proxy.decisions, host), host).toBe(true);
    expect(proxy.decisions.filter((d) => d.allow).map((d) => d.requested_host)).toEqual([
      `site.test:${String(P)}`,
    ]);
  });

  // Playwright already passes <-loopback>, so Chromium has no implicit loopback bypass to control
  // for; this pins that.
  it('NFR-09: loopback requests go through the proxy too', async () => {
    await visit(sandboxed, `http://site.test:${String(P)}/loopback`);
    expect(privateV4.hits).toEqual([]);
    expect(denied(proxy.decisions, `127.0.0.1:${String(privatePortV4)}`)).toBe(true);
  });

  it('control: without the WebRTC policy, STUN reaches a private address', async () => {
    const before = stun.packets();
    await withBrowser({ proxy: { server: proxy.url } }, (b) =>
      visit(b, `http://site.test:${String(P)}/webrtc`, 'window.gathered'),
    );
    expect(stun.packets()).toBeGreaterThan(before);
  });

  it('NFR-09: WebRTC STUN to a private IP never leaves the browser', async () => {
    const before = stun.packets();
    await visit(sandboxed, `http://site.test:${String(P)}/webrtc`, 'window.gathered');
    expect(stun.packets()).toBe(before);
  });
});
