/// <reference lib="dom" />
// The verifier (v1.0 §9.4, addendum A.3, D-031). Serves the checkout from memory (static files only,
// never a build or a repo script, D-008), reproduces the finding, applies the patch, re-runs every
// axe rule and diffs screenshots against the noise floor of two unpatched renders.
import axe from 'axe-core';
import type { Browser, Page } from 'playwright';

/** The checkout: path relative to the site root (no leading slash) -> file contents. */
export type SiteFiles = Record<string, string | Uint8Array>;
export type VerifyReason = 'violation_not_resolved' | 'new_violations' | 'visual_diff_over_cap';
export type Verification =
  | { status: 'unmapped'; code: 'UNMAPPED_LOCAL_MISMATCH' }
  | {
      status: 'passed' | 'failed';
      reasons: VerifyReason[];
      violationResolved: boolean;
      newViolations: number;
      /** Share of changed pixels outside the noise mask; 0 when within noise × k (A.3 step 5). */
      visualDiffRatio: number;
      noiseRatio: number;
      /** Asked for with { evidence: true }: what the fix changes for the person using the page. */
      evidence?: VerifyEvidence;
    };

export type VerifyEvidence = { before: string; after: string; crop: Uint8Array | null };

// Never resolvable, so nothing is fetched: every request is answered by the route below.
const ORIGIN = 'https://checkout.beacon.invalid';
// shortcut: k, the cap and the tile size are first guesses; calibrate on real sites before Phase 1 exit.
const NOISE_K = 3;
const HARD_CAP = 0.2;
const TILE = 16;
const FROZEN_TIME = new Date('2026-01-01T00:00:00Z');
const TYPES: Record<string, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  woff2: 'font/woff2',
};

type Violation = { rule: string; target: string };

/**
 * What assistive technology gets from the element: its accessibility-tree entry (role and name), or
 * for the document itself the language it declares. A crop shows which element it is.
 */
async function evidenceOf(p: Page, target: string) {
  if (target === 'html') {
    const lang = await p.evaluate(() => document.documentElement.lang);
    return { announced: `Page language: ${lang || 'not set'}`, crop: null };
  }
  const el = p.locator(`css=${target}`).first();
  // A finding that does not reproduce has no element here; verify() reports it as unmapped.
  if ((await el.count()) === 0) return undefined;
  const announced = (await el.ariaSnapshot({ timeout: 5_000 })).trim();
  const box = await el.boundingBox();
  const small =
    box !== null && box.width >= 1 && box.height >= 1 && box.width <= 1280 && box.height <= 800;
  const crop = small
    ? new Uint8Array(await el.screenshot({ animations: 'disabled', timeout: 5_000 }))
    : null;
  return { announced, crop };
}

async function render(browser: Browser, files: SiteFiles, page: string, target?: string) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  try {
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const body = Object.hasOwn(files, path) ? files[path] : undefined;
      if (body === undefined) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({
        contentType: TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
        body: typeof body === 'string' ? body : Buffer.from(body),
      });
    });
    const p = await context.newPage();
    await p.clock.setFixedTime(FROZEN_TIME);
    await p.goto(`${ORIGIN}/${page}`, { waitUntil: 'load' });
    await p.evaluate(axe.source);
    const results = await p.evaluate(() =>
      (window as unknown as { axe: typeof axe }).axe.run(document, { resultTypes: ['violations'] }),
    );
    const violations: Violation[] = results.violations.flatMap((v) =>
      v.nodes.map((n) => ({ rule: v.id, target: String(n.target[0]) })),
    );
    const png = await p.screenshot({ fullPage: true, animations: 'disabled' });
    const evidence = target === undefined ? undefined : await evidenceOf(p, target);
    return { violations, png, evidence };
  } finally {
    await context.close();
  }
}

/** Noise = pixels that differ between two unpatched renders; their tiles are masked from the diff. */
async function diff(browser: Browser, before: Buffer, again: Buffer, after: Buffer) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    return await page.evaluate(
      async ({ shots, tile }) => {
        const imgs = await Promise.all(
          shots.map(
            (b64) =>
              new Promise<HTMLImageElement>((done, fail) => {
                const img = new Image();
                img.onload = () => {
                  done(img);
                };
                img.onerror = fail;
                img.src = `data:image/png;base64,${b64}`;
              }),
          ),
        );
        const w = Math.max(...imgs.map((i) => i.width));
        const h = Math.max(...imgs.map((i) => i.height));
        const [a, b, c] = imgs.map((img) => {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.drawImage(img, 0, 0);
          return new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer);
        });
        if (!a || !b || !c) throw new Error('missing screenshot');
        const cols = Math.ceil(w / tile);
        const tileOf = (i: number) => Math.floor(i / w / tile) * cols + Math.floor((i % w) / tile);
        const masked = new Set<number>();
        let noise = 0;
        for (let i = 0; i < a.length; i++)
          if (a[i] !== b[i]) {
            noise++;
            masked.add(tileOf(i));
          }
        let open = 0;
        let changed = 0;
        for (let i = 0; i < a.length; i++) {
          if (masked.has(tileOf(i))) continue;
          open++;
          if (a[i] !== c[i]) changed++;
        }
        return { noiseRatio: noise / a.length, ratio: open ? changed / open : 0 };
      },
      { shots: [before, again, after].map((s) => s.toString('base64')), tile: TILE },
    );
  } finally {
    await context.close();
  }
}

const key = (v: Violation) => `${v.rule}\u0000${v.target}`;

function counts(violations: Violation[]) {
  const m = new Map<string, number>();
  for (const v of violations) m.set(key(v), (m.get(key(v)) ?? 0) + 1);
  return m;
}

export async function verify(
  browser: Browser,
  input: {
    files: SiteFiles;
    /** The page to render, relative to the site root. */
    page: string;
    /** The finding as the live scan reported it (axe rule and target selector). */
    finding: { engine_rule: string; target: string };
    patch: { path: string; after: string };
  },
  options: { evidence?: boolean } = {},
): Promise<Verification> {
  const target = key({ rule: input.finding.engine_rule, target: input.finding.target });
  const shows = options.evidence ? input.finding.target : undefined;
  const before = await render(browser, input.files, input.page, shows);
  if (!before.violations.some((v) => key(v) === target))
    return { status: 'unmapped', code: 'UNMAPPED_LOCAL_MISMATCH' };
  const again = await render(browser, input.files, input.page);
  const after = await render(
    browser,
    { ...input.files, [input.patch.path]: input.patch.after },
    input.page,
    shows,
  );

  const violationResolved = !after.violations.some((v) => key(v) === target);
  const was = counts(before.violations);
  let newViolations = 0;
  for (const [k, n] of counts(after.violations))
    if (k !== target) newViolations += Math.max(0, n - (was.get(k) ?? 0));
  const { noiseRatio, ratio } = await diff(browser, before.png, again.png, after.png);
  const visualDiffRatio = ratio > noiseRatio * NOISE_K ? ratio : 0;

  const reasons: VerifyReason[] = [];
  if (!violationResolved) reasons.push('violation_not_resolved');
  if (newViolations > 0) reasons.push('new_violations');
  if (visualDiffRatio > HARD_CAP) reasons.push('visual_diff_over_cap');
  return {
    status: reasons.length ? 'failed' : 'passed',
    reasons,
    violationResolved,
    newViolations,
    visualDiffRatio,
    noiseRatio,
    ...(before.evidence && after.evidence
      ? {
          evidence: {
            before: before.evidence.announced,
            after: after.evidence.announced,
            crop: after.evidence.crop,
          },
        }
      : {}),
  };
}
