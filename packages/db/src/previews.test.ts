// Fix previews (FR-29, D-056): the fix Beacon would make, verified on a copy of the live page, for the
// URL-only report. Not proposals: nothing here can be approved or exported, so they live apart.
import { blobRef } from '@beacon/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { savePreview, type FixPreviewRow } from './previews.ts';
import { loadReportInput, runHasCrop } from './report-links.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000e9';
let db: TestDb;
let seed: Record<string, string>;
let findingId: string;

beforeAll(async () => {
  db = await createTestDb('previews');
  seed = await seedOrg(db.sql, ORG);
  // Its own finding and page: the seed has a preview of its own on the seeded finding.
  const [page] = await db.sql<{ id: string }[]>`
    insert into pages (org_id, run_id, url) values (${ORG}, ${seed['run'] ?? ''}, 'https://example.test/about')
    returning id`;
  const [finding] = await db.sql<{ id: string }[]>`
    insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
    values (${ORG}, ${seed['run'] ?? ''}, ${page?.id ?? ''}, 'fp-preview', 'image-alt', 'critical', 'img', '<img>')
    returning id`;
  findingId = finding?.id ?? '';
});
afterAll(async () => {
  await db.drop();
});

const crop = blobRef(new Uint8Array([7]), 'image/png');
const PREVIEW: FixPreviewRow = {
  ruleId: 'image-alt',
  title: 'Add alt text to the studio photo',
  rationale: 'The photo shows the studio at work.',
  before: '<img src="img/studio.jpg">',
  after: '<img src="img/studio.jpg" alt="Potter shaping a bowl on a wheel">',
  announcedBefore: '- img',
  announcedAfter: '- img "Potter shaping a bowl on a wheel"',
  verified: true,
  crop,
};

it('FR-29: a preview is saved once per finding and listed in the report input with its page', async () => {
  const save = () =>
    asApp(db.sql, ORG, (tx) =>
      savePreview(tx, {
        orgId: ORG,
        runId: seed['run'] ?? '',
        findingId: seed['finding'] ?? '',
        preview: PREVIEW,
      }),
    );
  await save();
  await save(); // a retried step

  const input = await asApp(db.sql, ORG, (tx) => loadReportInput(tx, seed['run'] ?? ''));

  expect(input.previews.filter((p) => p.pageUrl === 'https://example.test/about')).toEqual([
    { pageUrl: 'https://example.test/about', ...PREVIEW },
  ]);
});

it('FR-27: a preview’s crop belongs to its run, so the report link may serve it', async () => {
  expect(await asApp(db.sql, ORG, (tx) => runHasCrop(tx, seed['run'] ?? '', crop))).toBe(true);
});

it('refuses a crop that is not a blob ref', async () => {
  const error = await asApp(db.sql, ORG, (tx) =>
    savePreview(tx, {
      orgId: ORG,
      runId: seed['run'] ?? '',
      findingId: seed['finding'] ?? '',
      preview: { ...PREVIEW, crop: 'file:///x' },
    }),
  ).catch((e: unknown) => (e as { code?: string }).code);

  expect(error).toBe('INVALID_BLOB_REF');
});
