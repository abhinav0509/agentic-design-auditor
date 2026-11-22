// pnpm fix scan [--agent-review] --repo <owner/repo> [page path ...]   scan, fix, verify; print the report
// pnpm fix approve <report link> (all | 1 2 ...)                       approve waiting fixes as the operator
// pnpm fix export <report link>                                        one verified PR with the approved fixes
// (D-054.) The site is the repo's GitHub Pages project site. GITHUB_TOKEN is a fine-grained token for that
// repo only; push access to the repo is what proves control of the site.
import { migrate, type Sql } from '@beacon/db';
import { checkout, GitHubProvider } from '@beacon/exporter';
import { chromiumLaunchOptions, guardContext, systemResolver } from '@beacon/scanner';
import { FsBlobStore } from '@beacon/worker';
import { randomBytes, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import postgres from 'postgres';
import { planFixRun } from './fix-plan.ts';
import { approveFixes, createReviewLink, exportFixes } from './fix-run.ts';
import { liveModel, reviewerBehindGate, startProxy } from './operator.ts';
import { runReport } from './run.ts';

const USAGE = `usage:
  pnpm fix scan [--agent-review] --repo <owner/repo> [page path ...]
  pnpm fix review-link <report link>         a reviewer page (this computer only) for the run
  pnpm fix approve <report link> (all | 1 2 ...)
  pnpm fix export <report link>
  pnpm fix pause <report link> [reason]      stop all agent work for the site's organisation
  pnpm fix resume <report link>
  pnpm fix audit <report link> > audit.json    the organisation's audit log, verifiable on its own`;

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`set ${name} (in .env.local or the shell)`);
    process.exit(2);
  }
  return v;
}
const fail = (message: string): never => {
  console.error(message);
  process.exit(2);
};
const tokenOf = (link: string | undefined) =>
  /([A-Za-z0-9_-]{32,128})\/?$/.exec(link ?? '')?.[1] ?? fail(`give the report link. ${USAGE}`);
const clock = { now: () => new Date() };
const blobs = new FsBlobStore(process.env['BEACON_BLOB_DIR'] ?? '.data/blobs');
const publicUrl = process.env['BEACON_PUBLIC_URL'] ?? 'http://127.0.0.1:4180';

/** The run's fixes, numbered the way `approve` takes them. */
async function listFixes(sql: Sql, token: string): Promise<void> {
  const { resolveReportLink, asApp } = await import('@beacon/db');
  const link = await resolveReportLink(sql, token, clock.now());
  if (!link) return;
  const rows = await asApp(
    sql,
    link.orgId,
    (tx) =>
      tx<{ status: string; title: string }[]>`
      select status, payload->>'title' as title from proposals
      where run_id = ${link.runId} and kind = 'patch' order by id`,
  );
  let n = 0;
  for (const r of rows) {
    const number = r.status === 'pending' ? `${String(++n)}.` : '  ';
    console.log(`  ${number} ${r.title} [${r.status}]`);
  }
  if (rows.length === 0) console.log('  No fixes were proposed.');
}

const [command, ...args] = process.argv.slice(2);
const sql = postgres(need('BEACON_DATABASE_URL'), { onnotice: () => undefined });
try {
  await migrate(sql);
  if (command === 'scan') {
    const planned = planFixRun(args);
    if (!planned.ok) fail(planned.error);
    const plan = planned.ok ? planned.plan : fail('unreachable');
    const git = new GitHubProvider({
      owner: plan.owner,
      repo: plan.repo,
      token: need('GITHUB_TOKEN'),
    });
    const repo = await git.call<{ permissions?: { push?: boolean } }>('GET', '');
    if (!repo?.permissions?.push)
      fail(
        `the token cannot push to ${plan.owner}/${plan.repo}, so it does not prove control of ${plan.siteUrl}`,
      );
    const defaultBranch = await git.defaultBranch();
    const head = (await git.headSha(defaultBranch)) ?? fail(`${defaultBranch} has no commits`);
    const files = plan.previewOnly ? {} : await checkout(git, head);
    const fixer = liveModel('Fixes');
    const reviewer = plan.agentReview ? reviewerBehindGate() : undefined;

    const proxy = await startProxy();
    const browser = await chromium.launch(chromiumLaunchOptions(proxy.url));
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await guardContext(context, systemResolver);
      console.log(`Scanning and fixing ${String(plan.urls.length)} page(s) of ${plan.siteUrl}…`);
      const { path, expiresAt } = await runReport(
        {
          sql,
          context,
          blobs,
          clock,
          token: () => randomBytes(32).toString('base64url'),
          ...(reviewer ? { reviewer } : {}),
          ...(plan.previewOnly
            ? { preview: { llm: fixer.llm, ids: { uuid: () => randomUUID() } } }
            : {}),
          ...(plan.previewOnly
            ? {}
            : {
                fix: {
                  llm: fixer.llm,
                  ids: { uuid: () => randomUUID() },
                  files,
                  commitSha: head,
                  repoFullName: `${plan.owner}/${plan.repo}`,
                  defaultBranch,
                },
              }),
        },
        plan,
      );
      console.log(
        `\nReport: ${publicUrl}${path}  (expires ${expiresAt.toISOString().slice(0, 10)})`,
      );
      console.log('Fixes:');
      await listFixes(sql, path.split('/').pop() ?? '');
      const review = await createReviewLink(
        { sql, clock },
        { shareToken: path.split('/').pop() ?? '', token: randomBytes(32).toString('base64url') },
      );
      console.log(`\nReview and approve (this computer only): http://127.0.0.1:4180${review}`);
      console.log('Start the pages with: pnpm report:serve');
    } finally {
      await browser.close();
      proxy.stop();
    }
  } else if (command === 'review-link') {
    const review = await createReviewLink(
      { sql, clock },
      { shareToken: tokenOf(args[0]), token: randomBytes(32).toString('base64url') },
    );
    console.log(`Review and approve (this computer only): http://127.0.0.1:4180${review}`);
  } else if (command === 'approve') {
    const token = tokenOf(args[0]);
    const which =
      args[1] === 'all'
        ? 'all'
        : args
            .slice(1)
            .map(Number)
            .filter((n) => n > 0);
    if (which !== 'all' && which.length === 0)
      fail(`say which fixes: all, or their numbers. ${USAGE}`);
    const done = await approveFixes(
      { sql, clock },
      { token, operatorEmail: need('BEACON_OPERATOR_EMAIL'), which },
    );
    for (const d of done) console.log(`  ${String(d.n)}. ${d.title} [${d.status}]`);
    if (done.length === 0) console.log('  Nothing was waiting for approval.');
    else console.log(`\nExport with: pnpm fix export ${args[0] ?? ''}`);
  } else if (command === 'export') {
    const token = tokenOf(args[0]);
    const { resolveReportLink, asApp } = await import('@beacon/db');
    const link =
      (await resolveReportLink(sql, token, clock.now())) ?? fail('no run for that report link');
    const [conn] = await asApp(
      sql,
      link.orgId,
      (tx) =>
        tx<{ repo_full_name: string }[]>`
        select c.repo_full_name from site_connections c
        join scan_runs r on r.site_id = c.site_id where r.id = ${link.runId}`,
    );
    const [owner = '', repo = ''] = (conn?.repo_full_name ?? fail('this run has no repo')).split(
      '/',
    );
    const git = new GitHubProvider({ owner, repo, token: need('GITHUB_TOKEN') });
    // The verifier serves the checkout from memory and aborts every other request: no proxy needed.
    const browser = await chromium.launch();
    try {
      const result = await exportFixes(
        { sql, browser, git, checkout: (sha) => checkout(git, sha), clock },
        token,
      );
      if (result.status === 'pr_open') console.log(`Pull request: ${result.pr.url}`);
      else console.log(`Not exported: ${JSON.stringify(result)}`);
      console.log(`Report: ${args[0] ?? ''}`);
    } finally {
      await browser.close();
    }
  } else if (command === 'pause' || command === 'resume') {
    const { resolveReportLink, asApp, setAgentPaused } = await import('@beacon/db');
    const link =
      (await resolveReportLink(sql, tokenOf(args[0]), clock.now())) ??
      fail('no run for that report link');
    const reason = args.slice(1).join(' ');
    await asApp(sql, link.orgId, (tx) =>
      setAgentPaused(tx, {
        paused: command === 'pause',
        at: clock.now(),
        ...(reason ? { reason } : {}),
      }),
    );
    console.log(
      command === 'pause'
        ? 'Agent work is paused for this organisation.'
        : 'Agent work is resumed.',
    );
  } else if (command === 'audit') {
    const { resolveReportLink, asApp, exportAuditLog } = await import('@beacon/db');
    const link =
      (await resolveReportLink(sql, tokenOf(args[0]), clock.now())) ??
      fail('no run for that report link');
    const log = await asApp(sql, link.orgId, (tx) => exportAuditLog(tx));
    console.log(JSON.stringify({ ...log, exportedAt: clock.now().toISOString() }, null, 2));
  } else fail(USAGE);
} finally {
  await sql.end();
}
