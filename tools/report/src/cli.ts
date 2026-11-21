// pnpm report [--agent-review] --requested-by <work email> <url> [url ...]   (D-045, D-048)
// Scans up to 10 pages of one site in the full sandbox (Smokescreen egress proxy + in-app guard,
// D-017, D-020), stores crops on disk and prints a 14-day share link to the report.
import type { LlmClient } from '@beacon/agent';
import { migrate } from '@beacon/db';
import { chromiumLaunchOptions, guardContext, systemResolver } from '@beacon/scanner';
import { FsBlobStore } from '@beacon/worker';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import postgres from 'postgres';
import { reviewerBehindGate, startProxy } from './operator.ts';
import { planReport } from './plan.ts';
import { runReport } from './run.ts';

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

// The agent review runs only behind its eval gate (D-041), on the model the gate measured.
let reviewer: { llm: LlmClient } | undefined;
if (planned.plan.agentReview) {
  try {
    reviewer = reviewerBehindGate();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
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
      ...(reviewer ? { reviewer } : {}),
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
