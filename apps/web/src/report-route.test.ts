// The share-link route (FR-27, FR-29, D-044): /r/<token> shows the run's report; its crops are served
// only for that run; anything expired, revoked, unknown or malformed is a plain 404.
import { InMemoryBlobStore } from '@beacon/core/testing';
import { asApp, createReportLink, revokeReportLink, savePageScan } from '@beacon/db';
import { createTestDb, seedOrg, type TestDb } from '@beacon/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleReportRequest } from './report-route.ts';

const ORG = '00000000-0000-4000-8000-0000000000d1';
const OTHER = '00000000-0000-4000-8000-0000000000d2';
const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';
const NOW = new Date('2026-11-15T10:00:00Z');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
const THEIR_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]);

let db: TestDb;
const blobs = new InMemoryBlobStore();
let crop: string;
let theirCrop: string;
let deps: Parameters<typeof handleReportRequest>[0];

async function seedRun(org: string, png: Uint8Array): Promise<{ run: string; crop: string }> {
  const seed = await seedOrg(db.sql, org);
  const run = seed['run'] ?? '';
  const ref = await blobs.put(png, 'image/png');
  await asApp(db.sql, org, (tx) =>
    savePageScan(tx, {
      orgId: org,
      runId: run,
      url: 'https://example.test/',
      served: '<html></html>',
      text: '',
      findings: [],
      reported: [
        {
          page_url: 'https://example.test/',
          engine_rule: 'link-name',
          impact: 'serious',
          target: 'a.cta',
          html: '<a class="cta"></a>',
          help: 'Links must have discernible text',
          tags: ['wcag2a', 'wcag244'],
        },
      ],
      crops: { 'a.cta': ref },
    }),
  );
  return { run, crop: ref };
}

beforeAll(async () => {
  db = await createTestDb('report_route');
  const mine = await seedRun(ORG, PNG);
  crop = mine.crop;
  theirCrop = (await seedRun(OTHER, THEIR_PNG)).crop;
  await asApp(db.sql, ORG, (tx) =>
    createReportLink(tx, {
      orgId: ORG,
      runId: mine.run,
      token: TOKEN,
      expiresAt: new Date('2026-11-29T10:00:00Z'),
    }),
  );
  deps = { sql: db.sql, blobs, clock: { now: () => NOW } };
});
afterAll(async () => {
  await db.drop();
});

const cropPath = (ref: string) => `/r/${TOKEN}/crops/${ref.slice('blob://'.length)}`;

describe('handleReportRequest', () => {
  it('FR-27: a valid link shows the report with headers that keep it private and script-free', async () => {
    const res = await handleReportRequest(deps, `/r/${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(String(res.body)).toContain('Links must have discernible text');
    expect(String(res.body)).toContain(`src="${cropPath(crop)}"`);
    expect(res.headers).toMatchObject({
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).not.toContain('script-src');
  });

  it('FR-27: an expired or revoked link is a 404 that shows no report data', async () => {
    const later = await handleReportRequest(
      { ...deps, clock: { now: () => new Date('2026-11-30T00:00:00Z') } },
      `/r/${TOKEN}`,
    );
    expect(later.status).toBe(404);
    expect(String(later.body)).not.toContain('discernible');

    const token = 'Revokedrevokedrevokedrevokedrevokedrevoked1';
    const seed = await db.sql<{ id: string }[]>`select id from scan_runs where org_id = ${ORG}`;
    const { id } = await asApp(db.sql, ORG, (tx) =>
      createReportLink(tx, {
        orgId: ORG,
        runId: seed[0]?.id ?? '',
        token,
        expiresAt: new Date('2026-11-29T10:00:00Z'),
      }),
    );
    await asApp(db.sql, ORG, (tx) => revokeReportLink(tx, { id, at: NOW }));
    expect((await handleReportRequest(deps, `/r/${token}`)).status).toBe(404);
  });

  it('FR-29: serves a crop of the link’s own run as a PNG', async () => {
    const res = await handleReportRequest(deps, cropPath(crop));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body).toEqual(PNG);
  });

  it('FR-27: will not serve another run’s crop, even one in the same blob store', async () => {
    const res = await handleReportRequest(deps, cropPath(theirCrop));

    expect(res.status).toBe(404);
  });

  it.each([
    '/r/short',
    '/r/../../etc/passwd',
    `/r/${TOKEN}/crops/../../x.png`,
    `/r/${TOKEN}/crops/sha256/${'g'.repeat(64)}.png`,
    `/r/${TOKEN}/extra`,
    '/',
    '/admin',
  ])('FR-27: a malformed or unknown path is a 404 (%s)', async (path) => {
    expect((await handleReportRequest(deps, path)).status).toBe(404);
  });
});
