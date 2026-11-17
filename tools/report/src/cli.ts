// pnpm report --requested-by <work email> <url> [url ...]   (D-045)
// Scans up to 10 pages of one site in the full sandbox (Smokescreen egress proxy + in-app guard,
// D-017, D-020), stores crops on disk and prints a 14-day share link to the report.
import { migrate } from '@beacon/db';
import { chromiumLaunchOptions, guardContext, systemResolver } from '@beacon/scanner';
import { FsBlobStore } from '@beacon/worker';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import postgres from 'postgres';
import { planReport } from './plan.ts';
import { runReport } from './run.ts';

const SMOKESCREEN = fileURLToPath(
  new URL('../../../.cache/smokescreen/v0.1.0/smokescreen', import.meta.url),
);

/** Smokescreen with its default policy: public addresses only. Resolves once it accepts connections. */
async function startProxy(): Promise<{ url: string; stop: () => void }> {
  if (!existsSync(SMOKESCREEN))
    throw new Error('Smokescreen is not installed: run pnpm smokescreen:install');
  const port = await new Promise<number>((done) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: p } = s.address() as net.AddressInfo;
      s.close(() => {
        done(p);
      });
    });
  });
  const proc = spawn(SMOKESCREEN, ['--listen-ip', '127.0.0.1', '--listen-port', String(port)], {
    stdio: 'ignore',
  });
  for (let tries = 0; tries < 50; tries++) {
    const up = await new Promise<boolean>((done) => {
      const c = net.connect(port, '127.0.0.1', () => {
        c.end();
        done(true);
      });
      c.on('error', () => {
        done(false);
      });
    });
    if (up) return { url: `http://127.0.0.1:${String(port)}`, stop: () => proc.kill() };
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('Smokescreen did not start');
}

const planned = planReport(process.argv.slice(2));
if (!planned.ok) {
  console.error(planned.error);
  process.exit(2);
}
const dbUrl = process.env['BEACON_DATABASE_URL'];
if (!dbUrl) {
  console.error('set BEACON_DATABASE_URL to a Postgres the app role (beacon_app) can be used on');
  process.exit(2);
}

const sql = postgres(dbUrl, { onnotice: () => undefined });
const proxy = await startProxy();
const browser = await chromium.launch(chromiumLaunchOptions(proxy.url));
try {
  await migrate(sql);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await guardContext(context, systemResolver);
  console.log(
    `Scanning ${String(planned.plan.urls.length)} page(s) of ${planned.plan.siteUrl} for ${planned.plan.requestedBy}…`,
  );
  const { path, expiresAt } = await runReport(
    {
      sql,
      context,
      blobs: new FsBlobStore(process.env['BEACON_BLOB_DIR'] ?? '.data/blobs'),
      clock: { now: () => new Date() },
      token: () => randomBytes(32).toString('base64url'),
    },
    planned.plan,
  );
  const base = process.env['BEACON_PUBLIC_URL'] ?? 'http://127.0.0.1:4180';
  console.log(`Report: ${base}${path}`);
  console.log(`Expires: ${expiresAt.toISOString()}. Serve it with pnpm report:serve.`);
} finally {
  await browser.close();
  proxy.stop();
  await sql.end();
}
