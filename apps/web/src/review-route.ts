// The reviewer page (FR-11, FR-14, D-055), framework-free like the report route:
//   GET  /review/<token>[?done=<code>]        the report with Approve, Reject and Open pull request
//   POST /review/<token>/approve/<proposal>   approve as the operator (decideProposal, D-051)
//   POST /review/<token>/reject/<proposal>    reject as the operator
//   POST /review/<token>/export               one verified PR with the approved fixes (exportRun, D-053)
// Only a reviewer token (can_review) opens it. A POST must come from this page's own origin (CSRF),
// and every action answers with a 303 back to the page, which then shows the outcome.
import type { BlobStore, Clock } from '@beacon/core';
import { asApp, decideProposal, ensureOperator, resolveReviewLink, type Sql } from '@beacon/db';
import { notFound, PRIVATE, reportPage, type WebResponse } from './report-route.ts';

export type ReviewDeps = {
  sql: Sql;
  blobs: BlobStore;
  clock: Clock;
  operatorEmail: string;
  exportRun: (link: {
    orgId: string;
    runId: string;
  }) => Promise<{ status: string; pr?: { number: number; url: string } }>;
};

const TOKEN = '[A-Za-z0-9_-]{32,128}';
const PAGE = new RegExp(`^/review/(${TOKEN})$`);
const ACTION = new RegExp(
  `^/review/(${TOKEN})/(?:(approve|reject)/([0-9a-f-]{36})|(export)|(approve-all))$`,
);

/** The only notices the page shows; a code outside this list shows nothing. */
const NOTICES: Record<string, string> = {
  approved: 'Fix approved. Open a pull request when you are ready.',
  approved_low:
    'Low-risk fixes approved. Medium and high risk fixes need approving one by one before the pull request.',
  rejected: 'Fix rejected. It will not be exported.',
  exported: 'Pull request opened. Each fix below links to it.',
  not_exported: 'No pull request was opened: nothing approved was ready to export.',
  conflict: 'That fix was already decided, so nothing changed.',
  paused:
    'Agent work is paused for this organisation, so nothing was exported. Resume it to export.',
};

const redirect = (token: string, done: string): WebResponse => ({
  status: 303,
  headers: { ...PRIVATE, location: `/review/${token}?done=${done}` },
  body: '',
});
const forbidden: WebResponse = {
  status: 403,
  headers: { ...PRIVATE, 'content-type': 'text/plain; charset=utf-8' },
  body: 'This action must come from the reviewer page.',
};

export async function handleReviewRequest(
  deps: ReviewDeps,
  req: { method: string; path: string; origin: string | null; host: string },
): Promise<WebResponse> {
  const [pathname = '', query = ''] = req.path.split('?');
  const now = deps.clock.now();

  if (req.method === 'GET') {
    const token = PAGE.exec(pathname)?.[1];
    if (token === undefined) return notFound();
    const link = await resolveReviewLink(deps.sql, token, now);
    if (!link) return notFound();
    const done = new URLSearchParams(query).get('done') ?? '';
    const notice = Object.hasOwn(NOTICES, done) ? NOTICES[done] : undefined;
    return reportPage(deps.sql, link, token, now, {
      actionBase: `/review/${token}`,
      ...(notice ? { notice } : {}),
    });
  }

  if (req.method !== 'POST') return notFound();
  const m = ACTION.exec(pathname);
  const token = m?.[1];
  if (!m || token === undefined) return notFound();
  const link = await resolveReviewLink(deps.sql, token, now);
  if (!link) return notFound();
  // CSRF: the form must have been posted by this page, from this origin.
  if (req.origin !== `http://${req.host}` && req.origin !== `https://${req.host}`) return forbidden;

  if (m[4] === 'export') {
    const result = await deps.exportRun(link);
    const done =
      result.status === 'pr_open'
        ? 'exported'
        : result.status === 'paused'
          ? 'paused'
          : 'not_exported';
    return redirect(token, done);
  }
  const operator = await ensureOperator(deps.sql, { orgId: link.orgId, email: deps.operatorEmail });
  if (m[5] === 'approve-all') {
    // FR-12: bulk approval covers low-risk fixes only, re-checked here, not taken from the page.
    await asApp(deps.sql, link.orgId, async (tx) => {
      const waiting = await tx<{ id: string; version: number }[]>`
        select id, version from proposals
        where run_id = ${link.runId} and status = 'pending' and kind = 'patch' and risk_level = 'low'
        order by id`;
      for (const p of waiting)
        await decideProposal(tx, {
          orgId: link.orgId,
          proposalId: p.id,
          userId: operator,
          input: {
            action: 'approve',
            key: `review-approve-v${String(p.version)}`,
            expectedVersion: p.version,
          },
          at: now.toISOString(),
        });
    });
    return redirect(token, 'approved_low');
  }
  const action = m[2] === 'approve' ? 'approve' : 'reject';
  const proposalId = m[3] ?? '';
  const decided = await asApp(deps.sql, link.orgId, async (tx) => {
    const [p] = await tx<{ status: string; version: number }[]>`
      select status, version from proposals where id = ${proposalId} and run_id = ${link.runId}`;
    if (p?.status !== 'pending') return false;
    await decideProposal(tx, {
      orgId: link.orgId,
      proposalId,
      userId: operator,
      // One key per proposal version: a double-submitted form replays instead of failing.
      input: { action, key: `review-${action}-v${String(p.version)}`, expectedVersion: p.version },
      at: now.toISOString(),
    });
    return true;
  });
  return redirect(token, decided ? (action === 'approve' ? 'approved' : 'rejected') : 'conflict');
}
