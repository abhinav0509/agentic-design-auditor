// The report server (D-045, D-055) as a module, so tests can run it on a free port and drive it with
// a real browser. `/r/<token>` is the shareable report; `/review/<token>` is the reviewer page, which
// the caller turns on only for a server bound to this computer.
import type { BlobStore, Clock } from '@beacon/core';
import type { Sql } from '@beacon/db';
import { handleReportRequest, handleReviewRequest, type ReviewDeps } from '@beacon/web';
import http from 'node:http';

export type ReportServerOptions = {
  sql: Sql;
  blobs: BlobStore;
  clock: Clock;
  /** Reviewer pages on: only for a server bound to loopback, with an operator to decide as. */
  review?: { operatorEmail: string; exportRun: ReviewDeps['exportRun'] };
};

function drain(req: http.IncomingMessage): Promise<void> {
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

export function createReportServer(o: ReportServerOptions): http.Server {
  return http.createServer((req, res) => {
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
      const review = o.review;
      if (!review) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found.');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST' }).end();
        return;
      }
      drain(req)
        .then(() =>
          handleReviewRequest(
            { sql: o.sql, blobs: o.blobs, clock: o.clock, ...review },
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
    handleReportRequest({ sql: o.sql, blobs: o.blobs, clock: o.clock }, url.pathname).then(
      send,
      fail,
    );
  });
}
