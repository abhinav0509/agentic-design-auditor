// Agent review results (FR-29, D-048): a page's flags with their crops, and the model's cost in the
// usage ledger (NFR-05), saved once per page, so a retried scan step neither duplicates flags nor
// charges twice.
import { blobRef, type DomainError } from '@beacon/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadReportInput } from './report-links.ts';
import { savePageReview, type ReviewFlagRow } from './reviews.ts';
import { savePageScan } from './scans.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000e1';
const URL_ = 'https://example.test/reviewed'; // not the seed's page, which has a seeded flag
let db: TestDb;
let runId: string;

beforeAll(async () => {
  db = await createTestDb('reviews');
  runId = (await seedOrg(db.sql, ORG))['run'] ?? '';
  await asApp(db.sql, ORG, (tx) =>
    savePageScan(tx, {
      orgId: ORG,
      runId,
      url: URL_,
      served: '<html></html>',
      text: '',
      findings: [],
    }),
  );
});
afterAll(async () => {
  await db.drop();
});

const crop = blobRef(new Uint8Array([9]), 'image/png');
const FLAGS: ReviewFlagRow[] = [
  {
    candidate: 'image',
    kind: 'unhelpful_alt',
    selector: 'html > body:nth-of-type(1) > img:nth-of-type(1)',
    text: 'IMG_0042.jpg',
    reason: 'The alt text is a camera file name.',
    suggestion: 'Potter shaping a bowl at the wheel',
    crop,
  },
  {
    candidate: 'link',
    kind: 'vague_link',
    selector: 'html > body:nth-of-type(1) > a:nth-of-type(1)',
    text: 'click here',
    reason: '"click here" does not say where the link goes.',
    suggestion: 'See workshop prices',
    crop: null,
  },
];
const USAGE = { inputTokens: 1200, outputTokens: 300, costMicros: 15_000 };
const save = (flags = FLAGS) =>
  asApp(db.sql, ORG, (tx) =>
    savePageReview(tx, { orgId: ORG, runId, url: URL_, flags, usage: USAGE }),
  );

it('FR-29: saves a page’s review flags and the model cost once; a retried save adds nothing', async () => {
  const ledgerRows = () => db.sql`
    select kind, units::int, cost_micros::int from usage_ledger where run_id = ${runId} order by id`;
  const before = await ledgerRows(); // the seed has a ledger row of its own

  expect(await save()).toBe(true);
  expect(await save()).toBe(false);

  const flags = await db.sql`
    select r.kind, r.current_text, r.suggestion, r.crop from review_flags r
    join pages p on p.id = r.page_id where p.url = ${URL_} order by r.kind`;
  expect(flags).toEqual([
    {
      kind: 'unhelpful_alt',
      current_text: 'IMG_0042.jpg',
      suggestion: 'Potter shaping a bowl at the wheel',
      crop,
    },
    {
      kind: 'vague_link',
      current_text: 'click here',
      suggestion: 'See workshop prices',
      crop: null,
    },
  ]);
  expect((await ledgerRows()).slice(before.length)).toEqual([
    { kind: 'model', units: 1500, cost_micros: 15_000 },
  ]);
});

it('FR-29: the report input lists reviewed pages and their flags', async () => {
  const input = await asApp(db.sql, ORG, (tx) => loadReportInput(tx, runId));

  expect(input.reviewedPages).toEqual([URL_]);
  expect(input.reviewFlags.filter((f) => f.pageUrl === URL_)).toEqual(
    FLAGS.map((f) => ({ pageUrl: URL_, ...f })).sort((a, b) => (a.selector < b.selector ? -1 : 1)),
  );
});

it('FR-29: refuses a crop that is not a blob ref, before writing anything', async () => {
  const error: unknown = await asApp(db.sql, ORG, (tx) =>
    savePageReview(tx, {
      orgId: ORG,
      runId,
      url: 'https://example.test/other',
      flags: [{ ...(FLAGS[0] as ReviewFlagRow), crop: 'file:///etc/passwd' }],
      usage: USAGE,
    }),
  ).catch((e: unknown) => e);

  expect((error as DomainError).code).toBe('INVALID_BLOB_REF');
});
