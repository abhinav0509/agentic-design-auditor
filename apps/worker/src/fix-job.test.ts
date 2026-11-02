// The fix job (v1.0 §9.1 steps 5-6, §9.2, §9.4; D-034): one scan finding -> mapper -> bounded fixer
// over the checkout -> verifier -> proposal. No real model: FakeLlm scripts every turn.
import { FakeLlm, textOnly, toolUse } from '@beacon/agent/testing';
import { IMAGES_DIR } from '@beacon/evals';
import { scanHtml } from '@beacon/scanner';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFixJob, siteTools } from './fix-job.ts';

const PAGE = readFileSync(new URL('../clean/about.html', IMAGES_DIR), 'utf8').replace(
  ' alt="Potter shaping a bowl on a wheel"',
  '',
);
const STUDIO = readFileSync(new URL('studio.jpg', IMAGES_DIR));
const FILES = { 'about.html': PAGE, 'img/studio.jpg': new Uint8Array(STUDIO) };
const URL_ = 'https://studio.example/about';
const IMG_AT = PAGE.indexOf('<img');

let next = 0;
const ids = { uuid: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}` };
const clock = { now: () => new Date('2026-11-02T10:00:00.000Z') };
const RUN = '11111111-1111-4111-8111-111111111111';

const patch = (value: string) => ({
  kind: 'patch',
  title: 'Add alt text to the studio photo',
  rationale: 'The photo shows the work of the studio.',
  confidence: 0.9,
  ops: [{ op: 'set_attr', at: IMG_AT, name: 'alt', value }],
});

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

/** Scans the page as served, the way a run does, and fixes its image-alt finding. */
async function fix(
  llm: FakeLlm,
  opts: { files?: Record<string, string | Uint8Array>; served?: string; target?: string } = {},
) {
  const served = opts.served ?? PAGE;
  const { findings, pageText } = await scanHtml(browser, URL_, served);
  const finding = findings.find((f) => f.rule_id === 'image-alt');
  if (!finding) throw new Error('the scan found no image-alt');
  return runFixJob(
    { browser, llm, clock, ids },
    {
      runId: RUN,
      site: { files: opts.files ?? FILES, commitSha: 'abc1234' },
      page: { url: URL_, served, text: pageText },
      finding: opts.target ? { ...finding, target: opts.target } : finding,
    },
  );
}

function gitApply(path: string, source: string, diff: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'beacon-job-'));
  writeFileSync(join(dir, path), source);
  writeFileSync(join(dir, 'change.diff'), diff);
  execFileSync('git', ['apply', 'change.diff'], { cwd: dir });
  return readFileSync(join(dir, path), 'utf8');
}

describe('runFixJob', { timeout: 60_000 }, () => {
  it('FR-08: a mapped finding becomes a verified pending proposal whose diff applies to the checkout', async () => {
    const llm = new FakeLlm([
      toolUse(['get_image', {}]),
      toolUse(['submit_proposal', patch('Potter shaping a bowl on a wheel')]),
    ]);
    const job = await fix(llm);
    if (job.kind !== 'proposal') throw new Error(`expected a proposal, got ${job.kind}`);
    expect(job.status).toBe('pending');
    expect(job.proposal).toMatchObject({
      run_id: RUN,
      kind: 'patch',
      rule: { id: 'image-alt' },
      target: { page_url: URL_, file: 'about.html', range: { start_line: 7 } },
      base: { commit_sha: 'abc1234' },
      verification: { violation_resolved: true, new_violations: 0, visual_diff_ratio: 0 },
    });
    const diff = job.proposal.change?.diff ?? '';
    expect(gitApply('about.html', PAGE, diff)).toContain(
      '<img src="/img/studio.jpg" alt="Potter shaping a bowl on a wheel">',
    );
  });

  it('FR-08: a patch the verifier rejects is failed_verification, never pending', async () => {
    // a space-only alt passes the guard, but axe still reports image-alt
    const llm = new FakeLlm([toolUse(['submit_proposal', patch(' ')])]);
    const job = await fix(llm);
    if (job.kind !== 'proposal') throw new Error(`expected a proposal, got ${job.kind}`);
    expect(job.status).toBe('failed_verification');
    expect(job.proposal.verification).toMatchObject({ violation_resolved: false });
  });

  it('FR-09: needs_input becomes an awaiting_input proposal with its question', async () => {
    const question = { text: 'What does the studio photo show?', options: [] };
    const llm = new FakeLlm([
      toolUse([
        'submit_proposal',
        { kind: 'needs_input', title: 'Ask', rationale: 'Unclear.', confidence: 0.3, question },
      ]),
    ]);
    const job = await fix(llm);
    if (job.kind !== 'proposal') throw new Error(`expected a proposal, got ${job.kind}`);
    expect(job.status).toBe('awaiting_input');
    expect(job.proposal.question).toEqual(question);
  });

  it('FR-06: an unmapped finding stops before the model (no call, no proposal)', async () => {
    const llm = new FakeLlm([]);
    const built = PAGE.replace('<main>', '<main class="built">');
    expect(await fix(llm, { served: built })).toEqual({
      kind: 'unmapped',
      reason: 'not_served_as_is',
    });
    expect(llm.calls).toHaveLength(0);
  });

  it('FR-08: a finding the checkout does not reproduce is UNMAPPED_LOCAL_MISMATCH, not a proposal', async () => {
    const llm = new FakeLlm([toolUse(['submit_proposal', patch('Potter shaping a bowl')])]);
    expect(await fix(llm, { target: 'img.not-on-this-page' })).toEqual({
      kind: 'unmapped',
      reason: 'UNMAPPED_LOCAL_MISMATCH',
    });
  });

  it('FR-07: a fixer run that ends without an answer is no proposal and keeps its trace', async () => {
    const llm = new FakeLlm([textOnly('I am not sure.'), new Error('upstream 500')]);
    const job = await fix(llm);
    expect(job.kind).toBe('no_proposal');
    if (job.kind === 'no_proposal') expect(job.fixer.kind).toBe('failed');
  });
});

describe('siteTools: read-only tools over the checkout', () => {
  const tools = siteTools(FILES, { pageUrl: URL_, snippet: '<img src="/img/studio.jpg">' });

  it('reads a text file whole or by line range; unknown and binary files are errors', async () => {
    expect(await tools.readFile('about.html')).toBe(PAGE);
    expect(await tools.readFile('about.html', { start: 7, end: 7 })).toBe(
      '<img src="/img/studio.jpg">',
    );
    await expect(tools.readFile('nope.html')).rejects.toThrow('no file nope.html');
    await expect(tools.readFile('img/studio.jpg')).rejects.toThrow('not a text file');
  });

  it('searches every text file and answers path:line: text', async () => {
    expect(await tools.searchSource('studio.jpg')).toBe(
      'about.html:7: <img src="/img/studio.jpg">',
    );
    expect(await tools.searchSource('no such text')).toBe('');
  });

  it('the image is the checkout file its src resolves to, as base64', async () => {
    expect(await tools.getImage()).toEqual({
      mediaType: 'image/jpeg',
      data: STUDIO.toString('base64'),
    });
    const missing = siteTools(FILES, { pageUrl: URL_, snippet: '<img src="/img/gone.jpg">' });
    await expect(missing.getImage()).rejects.toThrow('the image could not be loaded');
  });

  it('the DOM snippet is the scanned element', async () => {
    expect(await tools.getDomSnippet()).toBe('<img src="/img/studio.jpg">');
  });
});
