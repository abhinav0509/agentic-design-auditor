// A site's ownership token and proof (FR-03, FR-04, FR-04a, D-060): one token per site, kept until
// proven; a proof is fresh for 30 days (addendum 2.1), after which the site must prove it again.
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  issueOwnershipToken,
  ownershipFresh,
  recordOwnershipProof,
  registerSite,
} from './ownership.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000e6';
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb('ownership');
  await seedOrg(db.sql, ORG);
});
afterAll(async () => {
  await db.drop();
});

it('FR-03: registering a site is idempotent by its base URL', async () => {
  const a = await asApp(db.sql, ORG, (tx) =>
    registerSite(tx, { orgId: ORG, baseUrl: 'https://acme.test/' }),
  );
  const b = await asApp(db.sql, ORG, (tx) =>
    registerSite(tx, { orgId: ORG, baseUrl: 'https://acme.test/' }),
  );

  expect(a).toBe(b);
});

it('FR-04a: a site keeps one token until proven, and a proof is fresh for 30 days', async () => {
  const site = await asApp(db.sql, ORG, (tx) =>
    registerSite(tx, { orgId: ORG, baseUrl: 'https://proof.test/' }),
  );
  const first = await asApp(db.sql, ORG, (tx) =>
    issueOwnershipToken(tx, { siteId: site, token: 'bv_aaaaaaaaaaaaaaaa' }),
  );
  const again = await asApp(db.sql, ORG, (tx) =>
    issueOwnershipToken(tx, { siteId: site, token: 'bv_bbbbbbbbbbbbbbbb' }),
  );
  expect(again).toBe(first);

  const day = (d: number) => new Date(Date.UTC(2026, 10, d));
  expect(await asApp(db.sql, ORG, (tx) => ownershipFresh(tx, { siteId: site, now: day(1) }))).toBe(
    false,
  );
  await asApp(db.sql, ORG, (tx) => recordOwnershipProof(tx, { siteId: site, at: day(1) }));
  expect(await asApp(db.sql, ORG, (tx) => ownershipFresh(tx, { siteId: site, now: day(30) }))).toBe(
    true,
  );
  expect(
    await asApp(db.sql, ORG, (tx) =>
      ownershipFresh(tx, { siteId: site, now: new Date(Date.UTC(2026, 11, 2)) }),
    ),
  ).toBe(false);
});
