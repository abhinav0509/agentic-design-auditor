// pnpm report:serve (D-045, D-055): serves /r/<token> (the shareable report) and, when bound to this
// computer only, /review/<token> (the reviewer page with Approve, Reject and Open pull request).
// Binds to 127.0.0.1 unless HOST says otherwise; put it behind HTTPS before sharing a link outside.
import { asApp, type Sql } from '@beacon/db';
import { checkout, GitHubProvider } from '@beacon/exporter';
import { handleReportRequest, handleReviewRequest } from '@beacon/web';
import { exportRun, FsBlobStore } from '@beacon/worker';
import http from 'node:http';
import { chromium } from 'playwright';
import postgres from 'postgres';

const dbUrl = process.env['BEACON_DATABASE_URL'];
if (!dbUrl) {
  console.error('set BEACON_DATABASE_URL');
  process.exit(2);
}
const sql: Sql = postgres(dbUrl, { onnotice: () => undefined });
const clock = { now: () => new Date() };
const blobs = new FsBlobStore(process.env['BEACON_BLOB_DIR'] ?? '.data/blobs');
const host = process.env['HOST'] ?? '127.0.0.1';
const port = Number(process.env['PORT'] ?? 4180);
// Until sign-in exists (FR-01), the reviewer page is the operator's, so it is never served off-box.
const reviewOn = ['127.0.0.1', 'localhost', '::1'].includes(host);
const operatorEmail = process.env['BEACON_OPERATOR_EMAIL'] ?? '';

/** One verified PR with the run's approved fixes, on the repo recorded for the run's site. */
async function exportForLink(link: { orgId: string; runId: string }) {
  const token = process.env['GITHUB_TOKEN'];
  if (!token) throw new Error('set GITHUB_TOKEN to open pull requests');
  const [conn] = await asApp(
    sql,
    link.orgId,
    (tx) =>
      tx<{ repo_full_name: string }[]>`
      select c.repo_full_name from site_connections c
      join scan_runs r on r.site_id = c.site_id where r.id = ${link.runId}`,
  );
  if (!conn) return { status: 'nothing_to_export' };
  const [owner = '', repo = ''] = conn.repo_full_name.split('/');
  const git = new GitHubProvider({ owner, repo, token });
  // The verifier serves the checkout from memory and aborts every other request: no proxy needed.
  const browser = await chromium.launch();
  try {
    return await exportRun(
      { sql, browser, git, checkout: (sha) => checkout(git, sha), clock },
      link,
    );
  } finally {
    await browser.close();
  }
}

function body(req: http.IncomingMessage): Promise<void> {
  // Forms carry nothing the routes read (the action is in the path); drain and cap the body.
  return new Promise((done, fail) => {
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024) req.destroy(new Error('request body too large'));
    });
    req.on('end', done);
    req.on('error', fail);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://report.local');
    const send = (r: {
      status: number;
      headers: Record<string, string>;
      body: string | Uint8Array;
    }) => {
      res.writeHead(r.status, r.headers);
      res.end(req.method === 'HEAD' ? undefined : r.body);
    };
    const fail = (e: unknown) => {
      console.error(e); // details stay in the log, never in the response
      res
        .writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Something went wrong.');
    };

    if (url.pathname.startsWith('/review/')) {
      if (!reviewOn || !operatorEmail) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found.');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST' }).end();
        return;
      }
      body(req)
        .then(() =>
          handleReviewRequest(
            { sql, blobs, clock, operatorEmail, exportRun: exportForLink },
            {
              method: req.method ?? 'GET',
              path: `${url.pathname}${url.search}`,
              origin: req.headers.origin ?? null,
              host: req.headers.host ?? '',
            },
          ),
        )
        .then(send, fail);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    handleReportRequest({ sql, blobs, clock }, url.pathname).then(send, fail);
  })
  .listen(port, host, () => {
    console.log(`Reports on http://${host}:${String(port)}/r/<token>`);
    if (reviewOn && operatorEmail)
      console.log(`Reviewer pages on http://${host}:${String(port)}/review/<token>`);
    else
      console.log(
        'Reviewer pages are off (they need HOST on this computer and BEACON_OPERATOR_EMAIL).',
      );
  });
