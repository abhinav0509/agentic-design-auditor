// pnpm site add <url>      register a site and show how to prove control of it (FR-03, FR-04a, D-060)
// pnpm site verify <url>   check the proof in the scan sandbox and record it (fresh for 30 days)
import {
  asApp,
  issueOwnershipToken,
  migrate,
  recordOwnershipProof,
  registerSite,
} from '@beacon/db';
import {
  chromiumLaunchOptions,
  guardContext,
  systemResolver,
  verifyOwnership,
} from '@beacon/scanner';
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { chromium } from 'playwright';
import postgres from 'postgres';
import { startProxy } from './operator.ts';
import { orgIdFor } from './plan.ts';

const [command, raw] = process.argv.slice(2);
const dbUrl = process.env['BEACON_DATABASE_URL'];
if (!dbUrl || (command !== 'add' && command !== 'verify') || !raw) {
  console.error(
    'usage: pnpm site add <url> | pnpm site verify <url>   (needs BEACON_DATABASE_URL)',
  );
  process.exit(2);
}
let url: URL;
try {
  url = new URL(raw);
} catch {
  console.error(`not a URL: ${raw}`);
  process.exit(2);
}
if (url.protocol !== 'https:' && url.protocol !== 'http:') {
  console.error('the site must be an http(s) address');
  process.exit(2);
}
const siteUrl = `${url.protocol}//${url.host}/`;
const orgId = orgIdFor(url.host.replace(/^www\./, ''));
const sql = postgres(dbUrl, { onnotice: () => undefined });
try {
  await migrate(sql);
  const { siteId, token } = await asApp(sql, orgId, async (tx) => {
    await tx`insert into organizations (id, name) values (${orgId}, ${url.host}) on conflict (id) do nothing`;
    const id = await registerSite(tx, { orgId, baseUrl: siteUrl });
    const t = await issueOwnershipToken(tx, {
      siteId: id,
      token: `bv_${randomBytes(12).toString('hex')}`,
    });
    return { siteId: id, token: t };
  });

  if (command === 'add') {
    console.log(
      `Site registered: ${siteUrl}\n\nProve you control it with any one of these, then run pnpm site verify ${siteUrl}\n`,
    );
    console.log(`  DNS:   a TXT record on ${url.hostname} with the value  beacon-verify=${token}`);
    console.log(
      `  Page:  <meta name="beacon-verification" content="${token}"> in the <head> of ${siteUrl}`,
    );
    console.log(`  File:  ${siteUrl}.well-known/beacon-verification.txt containing  ${token}`);
  } else {
    const proxy = await startProxy();
    const browser = await chromium.launch(chromiumLaunchOptions(proxy.url));
    try {
      const context = await browser.newContext();
      await guardContext(context, systemResolver);
      const result = await verifyOwnership(
        { context, resolveTxt: (h) => dns.resolveTxt(h) },
        { siteUrl, token },
      );
      if (result.ok) {
        await asApp(sql, orgId, (tx) => recordOwnershipProof(tx, { siteId, at: new Date() }));
        console.log(
          `Verified by ${result.method.replace(/_/g, ' ')}. Scans may run for 30 days: pnpm report --site-proven ...`,
        );
      } else {
        console.error(
          `No proof found for ${siteUrl}. Check the record, tag or file shows exactly: ${token}`,
        );
        process.exitCode = 1;
      }
    } finally {
      await browser.close();
      proxy.stop();
    }
  }
} finally {
  await sql.end();
}
