// Share links for the URL-only report (FR-27, D-044): a link names one run, expires and can be
// revoked; only the token's hash is stored, and holding a token reveals that one link, nothing else.
import { blobRef } from '@beacon/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createReportLink,
  loadReportInput,
  resolveReportLink,
  revokeReportLink,
  runHasCrop,
} from './report-links.ts';
import { savePageError, savePageScan } from './scans.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';
const NOW = new Date('2026-11-15T10:00:00Z');
const LATER = new Date('2026-11-29T10:00:00Z');
const TOKEN = 'tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

let db: TestDb;
let seed: Record<string, string>;

beforeAll(async () => {
  db = await createTestDb('report_links');
  seed = await seedOrg(db.sql, ORG);
  await seedOrg(db.sql, OTHER);
});
afterAll(async () => {
  await db.drop();
});

const link = (token: string, expiresAt = LATER) =>
  asApp(db.sql, ORG, (tx) =>
    createReportLink(tx, { orgId: ORG, runId: seed['run'] ?? '', token, expiresAt }),
  );

it('FR-27: a link resolves to its org and run until it expires', async () => {
  await link(TOKEN);

  expect(await resolveReportLink(db.sql, TOKEN, NOW)).toEqual({ orgId: ORG, runId: seed['run'] });
  expect(await resolveReportLink(db.sql, TOKEN, LATER)).toBeNull();
});

it('FR-27: only the hash of the token is stored', async () => {
  const rows = await db.sql`select * from report_links`;

  expect(JSON.stringify(rows)).not.toContain(TOKEN);
});

it('FR-27: a revoked link no longer resolves', async () => {
  const token = 'tok_revoked_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const { id } = await link(token);

  await asApp(db.sql, ORG, (tx) => revokeReportLink(tx, { id, at: NOW }));

  expect(await resolveReportLink(db.sql, token, NOW)).toBeNull();
});

it('FR-27: an unknown or empty token resolves to nothing', async () => {
  expect(await resolveReportLink(db.sql, 'tok_nope', NOW)).toBeNull();
  expect(await resolveReportLink(db.sql, '', NOW)).toBeNull();
});

it('FR-27: holding a token reveals that one link, not the others', async () => {
  await link('tok_second_ccccccccccccccccccccccccccccccccccccccccc');

  const seen = await asApp(db.sql, null, async (tx) => {
    await tx`select set_config('app.report_token_hash', encode(sha256(${TOKEN}::bytea), 'hex'), true)`;
    return tx`select run_id from report_links`;
  });

  expect(seen).toHaveLength(1);
});

it('FR-27: another org cannot revoke a link', async () => {
  const token = 'tok_theirs_dddddddddddddddddddddddddddddddddddddddddd';
  const { id } = await link(token);

  await asApp(db.sql, OTHER, (tx) => revokeReportLink(tx, { id, at: NOW }));

  expect(await resolveReportLink(db.sql, token, NOW)).toEqual({ orgId: ORG, runId: seed['run'] });
});

it('FR-29: loads a run as report input: site, pages with errors, and every issue with its crop', async () => {
  const runId = seed['run'] ?? '';
  const crop = blobRef(new Uint8Array([5]), 'image/png');
  await asApp(db.sql, ORG, async (tx) => {
    await savePageScan(tx, {
      orgId: ORG,
      runId,
      url: 'https://example.test/about',
      served: '<html></html>',
      text: '',
      findings: [
        {
          page_url: 'https://example.test/about',
          rule_id: 'image-alt',
          engine_rule: 'image-alt',
          impact: 'critical',
          target: 'img.hero',
          html: '<img class="hero">',
        },
      ],
      reported: [
        {
          page_url: 'https://example.test/about',
          engine_rule: 'link-name',
          impact: 'serious',
          target: 'a',
          html: '<a></a>',
          help: 'Links must have discernible text',
          tags: ['wcag2a'],
        },
      ],
      crops: { 'img.hero': crop },
    });
    await savePageError(tx, {
      orgId: ORG,
      runId,
      url: 'https://example.test/admin',
      reason: 'URL_NOT_ALLOWED',
    });
  });

  const input = await asApp(db.sql, ORG, (tx) => loadReportInput(tx, runId));

  expect(input.siteUrl).toMatch(/^https?:\/\//);
  expect(input.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(input.pages).toEqual(
    expect.arrayContaining([
      { url: 'https://example.test/about', error: null },
      { url: 'https://example.test/admin', error: 'URL_NOT_ALLOWED' },
    ]),
  );
  expect(input.issues).toEqual(
    expect.arrayContaining([
      {
        pageUrl: 'https://example.test/about',
        ruleId: 'image-alt',
        actionable: true,
        impact: 'critical',
        selector: 'img.hero',
        html: '<img class="hero">',
        help: null,
        tags: [],
        crop,
      },
      {
        pageUrl: 'https://example.test/about',
        ruleId: 'link-name',
        actionable: false,
        impact: 'serious',
        selector: 'a',
        html: '<a></a>',
        help: 'Links must have discernible text',
        tags: ['wcag2a'],
        crop: null,
      },
    ]),
  );
  expect(await asApp(db.sql, ORG, (tx) => runHasCrop(tx, runId, crop))).toBe(true);
  expect(
    await asApp(db.sql, ORG, (tx) =>
      runHasCrop(tx, runId, blobRef(new Uint8Array([6]), 'image/png')),
    ),
  ).toBe(false);
});
