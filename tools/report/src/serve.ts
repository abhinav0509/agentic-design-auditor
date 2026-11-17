// pnpm report:serve (D-045): serves /r/<token> and its crops from the report route. Binds to
// 127.0.0.1 unless HOST says otherwise; put it behind HTTPS before sharing a link outside.
import { FsBlobStore } from '@beacon/worker';
import { handleReportRequest } from '@beacon/web';
import http from 'node:http';
import postgres from 'postgres';

const dbUrl = process.env['BEACON_DATABASE_URL'];
if (!dbUrl) {
  console.error('set BEACON_DATABASE_URL');
  process.exit(2);
}
const sql = postgres(dbUrl, { onnotice: () => undefined });
const deps = {
  sql,
  blobs: new FsBlobStore(process.env['BEACON_BLOB_DIR'] ?? '.data/blobs'),
  clock: { now: () => new Date() },
};
const host = process.env['HOST'] ?? '127.0.0.1';
const port = Number(process.env['PORT'] ?? 4180);

http
  .createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://report.local').pathname;
    handleReportRequest(deps, path).then(
      (r) => {
        res.writeHead(r.status, r.headers);
        res.end(req.method === 'HEAD' ? undefined : r.body);
      },
      (e: unknown) => {
        console.error(e); // details stay in the log, never in the response
        res
          .writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          .end('Something went wrong.');
      },
    );
  })
  .listen(port, host, () => {
    console.log(`Reports on http://${host}:${String(port)}/r/<token>`);
  });
