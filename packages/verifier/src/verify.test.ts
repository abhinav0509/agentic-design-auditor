// The verifier (v1.0 §9.4, addendum A.3): static-serve the checkout, reproduce the finding, apply the
// patch, re-run the engine and diff screenshots against a measured noise floor.
import { classifyRisk, ERROR_CODES } from '@beacon/core';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verify, type SiteFiles } from './verify.ts';

const page = (body: string, html = '<html lang="en">') => `<!doctype html>
${html}
<head><meta charset="utf-8"><title>Studio</title><link rel="stylesheet" href="/site.css"></head>
<body>
${body}
</body>
</html>`;
const BODY = `<main>
<h1>About the studio</h1>
<img src="/img/studio.jpg" width="320" height="240">
<p>We started with one kiln.</p>
</main>`;
const BEFORE = page(BODY);
const fixed = (html: string) => html.replace('<img ', '<img alt="Potter shaping a bowl" ');

const files = (index = BEFORE): SiteFiles => ({
  'index.html': index,
  'site.css': 'body { font-family: sans-serif; margin: 24px; }',
  'img/studio.jpg': readFileSync(
    new URL('../../../fixtures/corpus/images/studio.jpg', import.meta.url),
  ),
});
const finding = { engine_rule: 'image-alt', target: 'img' };
const run = (after: string, index = BEFORE) =>
  verify(browser, {
    files: files(index),
    page: 'index.html',
    finding,
    patch: { path: 'index.html', after },
  });

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe('verifier', { timeout: 60_000 }, () => {
  it('FR-08: violation gone and no new ones: pass', async () => {
    expect(await run(fixed(BEFORE))).toEqual({
      status: 'passed',
      reasons: [],
      violationResolved: true,
      newViolations: 0,
      visualDiffRatio: 0,
      noiseRatio: 0,
    });
  });

  it('violation not reproducible locally is UNMAPPED_LOCAL_MISMATCH', async () => {
    expect(ERROR_CODES).toContain('UNMAPPED_LOCAL_MISMATCH');
    expect(await run(fixed(BEFORE), fixed(BEFORE))).toEqual({
      status: 'unmapped',
      code: 'UNMAPPED_LOCAL_MISMATCH',
    });
  });

  it('FR-08: new violation: fail, for any engine rule, not only the MVP ones', async () => {
    const noLang = fixed(BEFORE).replace(' lang="en"', '');
    expect(await run(noLang)).toMatchObject({
      status: 'failed',
      reasons: ['new_violations'],
      violationResolved: true,
      newViolations: 1,
    });
    const emptyButton = fixed(BEFORE).replace('</main>', '<button></button>\n</main>');
    expect(await run(emptyButton)).toMatchObject({ status: 'failed', newViolations: 1 });
  });

  it('FR-08: a patch that leaves the violation in place fails', async () => {
    const elsewhere = BEFORE.replace('one kiln.', 'one small kiln.');
    expect(await run(elsewhere)).toMatchObject({
      status: 'failed',
      reasons: ['violation_not_resolved'],
      violationResolved: false,
    });
  });

  it('visual diff over threshold raises risk', async () => {
    const v = await run(
      fixed(BEFORE).replace('<h1>', '<h1 style="background: #000; color: #fff">'),
    );
    expect(v).toMatchObject({ status: 'passed' });
    if (v.status === 'unmapped') throw new Error('unexpected');
    expect(v.visualDiffRatio).toBeGreaterThan(0.01);
    const risk = classifyRisk({
      ruleId: 'image-alt',
      ops: [],
      changedLines: 1,
      confidence: 0.9,
      context: {
        pageUrl: 'https://example.com/about',
        insideForm: false,
        decorativeAgreed: false,
        visualDiffRatio: v.visualDiffRatio,
      },
    });
    expect(risk).toMatchObject({ level: 'high', reasons: ['visual_change'] });
  });

  it('visual diff above the hard cap fails', async () => {
    const dark = fixed(BEFORE).replace('<body>', '<body style="background: #000">');
    expect(await run(dark)).toMatchObject({ status: 'failed', reasons: ['visual_diff_over_cap'] });
  });

  it('renders are stable: the clock is frozen, animations are off and random noise is masked', async () => {
    const live = page(
      `${BODY}
<p id="now"></p><p id="rnd"></p><div class="spin">*</div>
<style>.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }</style>
<script>now.textContent = new Date().toISOString(); rnd.textContent = Math.random().toFixed(6);</script>`,
    );
    const v = await run(fixed(live), live);
    expect(v).toMatchObject({ status: 'passed', visualDiffRatio: 0 });
    if (v.status === 'unmapped') throw new Error('unexpected');
    expect(v.noiseRatio).toBeGreaterThan(0);
  });

  it('NFR-02: the page cannot reach any origin but the checkout', async () => {
    const hits: string[] = [];
    const server: Server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('ok');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const outside = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      const leaky = page(
        `${BODY}
<img src="${outside}/pixel.png" alt="">
<script src="${outside}/x.js"></script>
<script>fetch('${outside}/beacon').catch(() => {});</script>`,
      );
      await run(fixed(leaky), leaky);
      expect(hits).toEqual([]);
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    }
  });
});

describe('verifier evidence', { timeout: 60_000 }, () => {
  const withEvidence = (
    finding: { engine_rule: string; target: string },
    index: string,
    after: string,
  ) =>
    verify(
      browser,
      { files: files(index), page: 'index.html', finding, patch: { path: 'index.html', after } },
      { evidence: true },
    );

  it('FR-10: shows what assistive technology announces for the element before and after, with a crop of it', async () => {
    const v = await withEvidence(finding, BEFORE, fixed(BEFORE));

    expect(v).toMatchObject({
      status: 'passed',
      evidence: { before: '- img', after: '- img "Potter shaping a bowl"' },
    });
    if (v.status === 'unmapped') throw new Error('unreachable');
    expect([...(v.evidence?.crop?.slice(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('FR-10: for a form field, the announced name appears once it is labelled', async () => {
    const field = page('<main><h1>Join</h1><input type="email"></main>');
    const v = await withEvidence(
      { engine_rule: 'label', target: 'input' },
      field,
      field.replace('<input type="email">', '<input type="email" aria-label="Email address">'),
    );

    expect(v).toMatchObject({
      evidence: { before: '- textbox', after: '- textbox "Email address"' },
    });
  });

  it('FR-10: for the page language, the evidence is the language a screen reader is told to use', async () => {
    const noLang = page(BODY, '<html>');
    const v = await withEvidence(
      { engine_rule: 'html-has-lang', target: 'html' },
      noLang,
      page(BODY),
    );

    expect(v).toMatchObject({
      evidence: { before: 'Page language: not set', after: 'Page language: en', crop: null },
    });
  });

  it('keeps the plain result unless evidence is asked for', async () => {
    expect(await run(fixed(BEFORE))).not.toHaveProperty('evidence');
  });

  it('FR-08: a finding that does not reproduce is still unmapped, without waiting for its element', async () => {
    const started = Date.now();
    const v = await verify(
      browser,
      {
        files: files(BEFORE),
        page: 'index.html',
        finding: { engine_rule: 'image-alt', target: 'img.not-on-this-page' },
        patch: { path: 'index.html', after: fixed(BEFORE) },
      },
      { evidence: true },
    );

    expect(v).toEqual({ status: 'unmapped', code: 'UNMAPPED_LOCAL_MISMATCH' });
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});
