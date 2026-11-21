// The share-link route (FR-27, FR-29, D-044), framework-free so any server can mount it:
//   GET /r/<token>                          the run's report
//   GET /r/<token>/crops/sha256/<hex>.png   a crop, only when it belongs to that run
// Expired, revoked, unknown and malformed all answer the same 404, so a token cannot be probed.
import type { BlobStore, Clock } from '@beacon/core';
import { asApp, loadReportInput, resolveReportLink, runHasCrop, type Sql } from '@beacon/db';
import { buildReport, renderReport } from '@beacon/report';

export type WebResponse = {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
};

const TOKEN = '[A-Za-z0-9_-]{32,128}';
const REPORT = new RegExp(`^/r/(${TOKEN})$`);
const CROP = new RegExp(`^/r/(${TOKEN})/crops/(sha256/[0-9a-f]{64}\\.png)$`);

// No script may run; styles are inline; images only from this origin. The token is in the URL, so
// it must never leak through a Referer, a search index or a shared cache.
export const PRIVATE = {
  'content-security-policy':
    "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
};

const GONE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report not available</title></head>
<body><main><h1>This report is not available</h1>
<p>The link may have expired or been revoked. Ask the person who shared it for a new one.</p></main></body></html>
`;

export const notFound = (): WebResponse => ({
  status: 404,
  headers: { ...PRIVATE, 'content-type': 'text/html; charset=utf-8' },
  body: GONE_PAGE,
});

export async function handleReportRequest(
  deps: { sql: Sql; blobs: BlobStore; clock: Clock },
  path: string,
): Promise<WebResponse> {
  const report = REPORT.exec(path);
  const crop = CROP.exec(path);
  const token = report?.[1] ?? crop?.[1];
  if (token === undefined) return notFound();
  const now = deps.clock.now();
  const link = await resolveReportLink(deps.sql, token, now);
  if (!link) return notFound();

  if (crop) {
    const ref = `blob://${crop[2] ?? ''}`;
    const owned = await asApp(deps.sql, link.orgId, (tx) => runHasCrop(tx, link.runId, ref));
    const png = owned ? await deps.blobs.get(ref) : null;
    if (!png) return notFound();
    return { status: 200, headers: { ...PRIVATE, 'content-type': 'image/png' }, body: png };
  }

  return reportPage(deps.sql, link, token, now);
}

/**
 * A run's report page for a token (share or reviewer). With `review`, it carries the reviewer's
 * controls and a CSP that lets its forms post back to this origin only.
 */
export async function reportPage(
  sql: Sql,
  link: { orgId: string; runId: string },
  token: string,
  now: Date,
  review?: { actionBase: string; notice?: string },
): Promise<WebResponse> {
  const [input, expiresAt] = await asApp(sql, link.orgId, async (tx) => {
    const rows = await loadReportInput(tx, link.runId);
    const [l] = await tx<{ expires_at: Date }[]>`
      select expires_at from report_links where run_id = ${link.runId}
        and token_hash = sha256(${token}::bytea)`;
    return [rows, l?.expires_at ?? now] as const;
  });
  const html = renderReport(buildReport(input), {
    siteUrl: input.siteUrl,
    scannedAt: input.scannedAt,
    expiresAt: expiresAt.toISOString(),
    cropUrl: (ref) => `/r/${token}/crops/${ref.slice('blob://'.length)}`,
    ...(review ? { review } : {}),
  });
  const csp = review
    ? PRIVATE['content-security-policy'].replace("form-action 'none'", "form-action 'self'")
    : PRIVATE['content-security-policy'];
  return {
    status: 200,
    headers: {
      ...PRIVATE,
      'content-security-policy': csp,
      'content-type': 'text/html; charset=utf-8',
    },
    body: html,
  };
}
