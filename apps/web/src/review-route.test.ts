// The reviewer page (FR-11, FR-14, D-055): a reviewer link shows the report with controls; its forms
// approve, reject and export through the same code as the CLI. A share link cannot reach it, and a
// cross-site form post is refused.
import { makeProposal } from '@beacon/core/testing';
import { InMemoryBlobStore } from '@beacon/core/testing';
import { asApp, createReportLink, saveProposal } from '@beacon/db';
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleReviewRequest, type ReviewDeps } from './review-route.ts';

const ORG = '00000000-0000-4000-8000-0000000000d5';
const REVIEW = 'Reviewreviewreviewreviewreviewreviewreview1';
const SHARE = 'Shareshareshareshareshareshareshareshare123';
const NOW = new Date('2026-10-30T09:00:00Z'); // before the example proposal expires
const HOST = '127.0.0.1:4180';
const ORIGIN = `http://${HOST}`;
let db: TestDb;
let runId: string;
const exported: string[] = [];
let deps: ReviewDeps;

beforeAll(async () => {
  db = await createTestDb('review_route');
  const seed = await seedOrg(db.sql, ORG);
  runId = seed['run'] ?? '';
  const [finding] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
    values (${ORG}, ${runId}, ${seed['page'] ?? ''}, 'fp-review', 'image-alt', 'critical', 'img', '<img>')
    returning id`;
  await asApp(db.sql, ORG, async (tx) => {
    for (const [i, id] of [
      '00000000-0000-4000-8000-000000000b01',
      '00000000-0000-4000-8000-000000000b02',
    ].entries()) {
      const [f] =
        i === 0
          ? [finding]
          : await tx<{ id: string }[]>`
        insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
        values (${ORG}, ${runId}, ${seed['page'] ?? ''}, 'fp-review-2', 'image-alt', 'critical', 'img.b', '<img>') returning id`;
      await saveProposal(tx, {
        orgId: ORG,
        findingId: f?.id ?? '',
        proposal: makeProposal({ proposal_id: id, run_id: runId, title: `Fix ${String(i + 1)}` }),
        status: 'pending',
      });
    }
    await createReportLink(tx, {
      orgId: ORG,
      runId,
      token: REVIEW,
      expiresAt: new Date('2026-11-29T00:00:00Z'),
      canReview: true,
    });
    await createReportLink(tx, {
      orgId: ORG,
      runId,
      token: SHARE,
      expiresAt: new Date('2026-11-29T00:00:00Z'),
    });
  });
  deps = {
    sql: db.sql,
    blobs: new InMemoryBlobStore(),
    clock: { now: () => NOW },
    operatorEmail: 'operator@beacon.test',
    exportRun: (link) => {
      exported.push(link.runId);
      return Promise.resolve({
        status: 'pr_open',
        pr: { number: 9, url: 'https://github.com/jo/shop/pull/9' },
      });
    },
  };
});
afterAll(async () => {
  await db.drop();
});

const get = (path: string) =>
  handleReviewRequest(deps, { method: 'GET', path, origin: null, host: HOST });
const post = (path: string, origin: string | null = ORIGIN) =>
  handleReviewRequest(deps, { method: 'POST', path, origin, host: HOST });
const statusOf = async (id: string) =>
  (await db.sql`select status from proposals where id = ${id}`)[0]?.['status'] as string;

describe('handleReviewRequest', () => {
  it('FR-11: a reviewer link shows the report with controls and a CSP that lets its forms post only to itself', async () => {
    const res = await get(`/review/${REVIEW}`);

    expect(res.status).toBe(200);
    expect(String(res.body)).toContain(
      `action="/review/${REVIEW}/approve/00000000-0000-4000-8000-000000000b01"`,
    );
    expect(res.headers['content-security-policy']).toContain("form-action 'self'");
    expect(res.headers['content-security-policy']).not.toContain('script-src');
    // same-origin, not no-referrer: under no-referrer browsers send Origin: null on the form posts.
    expect(res.headers['referrer-policy']).toBe('same-origin');
  });

  it('FR-11: a share link cannot open the reviewer page', async () => {
    expect((await get(`/review/${SHARE}`)).status).toBe(404);
    expect(
      (await post(`/review/${SHARE}/approve/00000000-0000-4000-8000-000000000b01`)).status,
    ).toBe(404);
  });

  it('FR-11: Approve and Reject decide as the operator and come back to the page with what happened', async () => {
    const approve = await post(`/review/${REVIEW}/approve/00000000-0000-4000-8000-000000000b01`);
    const reject = await post(`/review/${REVIEW}/reject/00000000-0000-4000-8000-000000000b02`);

    expect(approve).toMatchObject({
      status: 303,
      headers: { location: `/review/${REVIEW}?done=approved` },
    });
    expect(reject).toMatchObject({
      status: 303,
      headers: { location: `/review/${REVIEW}?done=rejected` },
    });
    expect(await statusOf('00000000-0000-4000-8000-000000000b01')).toBe('approved');
    expect(await statusOf('00000000-0000-4000-8000-000000000b02')).toBe('rejected');
    expect(String((await get(`/review/${REVIEW}?done=approved`)).body)).toContain('role="status"');
  });

  it('FR-12: bulk approve approves only low-risk waiting fixes; medium and high risk wait for one-by-one approval', async () => {
    const low = '00000000-0000-4000-8000-000000000b03';
    const medium = '00000000-0000-4000-8000-000000000b04';
    for (const [id, level, fp] of [
      [low, 'low', 'fp-review-3'],
      [medium, 'medium', 'fp-review-4'],
    ] as const) {
      const [finding] = await db.sql<{ id: string }[]>`
        insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
        select ${ORG}, ${runId}, page_id, ${fp}, 'image-alt', 'critical', ${`img.${fp}`}, '<img>'
        from findings where run_id = ${runId} limit 1 returning id`;
      await asApp(db.sql, ORG, (tx) =>
        saveProposal(tx, {
          orgId: ORG,
          findingId: finding?.id ?? '',
          proposal: makeProposal({
            proposal_id: id,
            run_id: runId,
            title: `Fix ${level}`,
            risk: { level, reasons: [], reversible: true },
          }),
          status: 'pending',
        }),
      );
    }

    const res = await post(`/review/${REVIEW}/approve-all`);

    expect(res).toMatchObject({
      status: 303,
      headers: { location: `/review/${REVIEW}?done=approved_low` },
    });
    expect(await statusOf(low)).toBe('approved');
    expect(await statusOf(medium)).toBe('pending');
    expect(String((await get(`/review/${REVIEW}?done=approved_low`)).body)).toContain(
      'Low-risk fixes approved',
    );
  });

  it('FR-14: Open pull request exports the run and comes back with the outcome', async () => {
    const res = await post(`/review/${REVIEW}/export`);

    expect(res).toMatchObject({
      status: 303,
      headers: { location: `/review/${REVIEW}?done=exported` },
    });
    expect(exported).toEqual([runId]);
  });

  it('FR-28: an export refused because agent work is paused says so', async () => {
    const paused = { ...deps, exportRun: () => Promise.resolve({ status: 'paused' }) };

    const res = await handleReviewRequest(paused, {
      method: 'POST',
      path: `/review/${REVIEW}/export`,
      origin: ORIGIN,
      host: HOST,
    });

    expect(res).toMatchObject({
      status: 303,
      headers: { location: `/review/${REVIEW}?done=paused` },
    });
    expect(String((await get(`/review/${REVIEW}?done=paused`)).body)).toContain(
      'Agent work is paused',
    );
  });

  it('FR-11: a form post from another site, or with no origin, is refused and changes nothing', async () => {
    const id = '00000000-0000-4000-8000-000000000b01';
    expect((await post(`/review/${REVIEW}/reject/${id}`, 'https://evil.test')).status).toBe(403);
    expect((await post(`/review/${REVIEW}/reject/${id}`, null)).status).toBe(403);
    expect(await statusOf(id)).toBe('approved');
  });

  it('FR-11: unknown paths, unknown actions and an unknown notice code are a 404 or ignored', async () => {
    expect((await post(`/review/${REVIEW}/delete/x`)).status).toBe(404);
    expect((await get(`/review/${REVIEW}/../r/${SHARE}`)).status).toBe(404);
    expect(String((await get(`/review/${REVIEW}?done=<script>`)).body)).not.toContain('<script>');
  });
});
