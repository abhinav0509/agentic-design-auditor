// The URL-only report as one static, accessible HTML page (FR-17, FR-29, D-044). No script runs on
// it. Page content (snippets, URLs, axe help text) is untrusted and only ever appears as text.
import type { Report } from './build.ts';

export type RenderOptions = {
  siteUrl: string;
  scannedAt: string;
  expiresAt: string;
  /** Where the page loads a crop from; the route checks the crop belongs to the link's run. */
  cropUrl: (ref: string) => string;
};

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`;

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** A link only for http(s) addresses; anything else is shown as text. */
const pageLink = (url: string) =>
  /^https?:\/\//i.test(url) ? `<a href="${esc(url)}">${esc(url)}</a>` : esc(url);

const IMPACT_LABEL: Record<string, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};

const CSS = `
:root{color-scheme:light dark;--bg:#f5f6f8;--surface:#fff;--ink:#16181d;--ink-2:#454a54;--line:#dfe2e7;--accent:#3b2fd0;
--crit-bg:#fde8e8;--crit:#8a1c1c;--seri-bg:#fff0de;--seri:#7a3d00;--mode-bg:#fff7d1;--mode:#614a00;--mino-bg:#eceef2;--mino:#3a404a}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--surface:#171a20;--ink:#eceef2;--ink-2:#b8bdc7;--line:#2c313a;--accent:#a99fff;
--crit-bg:#3b1515;--crit:#ffb4b4;--seri-bg:#3a250f;--seri:#ffc98f;--mode-bg:#353010;--mode:#f3dc7a;--mino-bg:#262a31;--mino:#c9ced7}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent);text-underline-offset:2px}
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.wrap{max-width:860px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid var(--line);background:var(--surface)}
header.top p{margin:0;padding:14px 0;font-weight:700;letter-spacing:-.01em}
main{padding:40px 0 24px}
h1{font-size:clamp(1.6rem,4vw,2.2rem);line-height:1.2;letter-spacing:-.02em;margin:0 0 8px}
h2{font-size:1.25rem;margin:48px 0 12px;letter-spacing:-.01em}
h3{font-size:1.05rem;margin:0}
.meta,.note,.small{color:var(--ink-2)}
.meta{margin:0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:16px 0 0;padding:0}
.stats div{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stats dt{color:var(--ink-2);font-size:.875rem}
.stats dd{margin:2px 0 0;font-size:1.6rem;font-weight:700;font-variant-numeric:tabular-nums}
.card img{display:block;max-width:100%;height:auto;margin:8px 0;border:1px solid var(--line);border-radius:8px}
.suggestion{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:var(--bg);border:1px solid var(--line)}
.suggestion-label{font-weight:600}
q{font-style:italic}
.announced{border-collapse:collapse;margin:12px 0;font-size:.875rem}
.announced caption{text-align:left;font-weight:600;padding-bottom:4px}
.announced th,.announced td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
pre.diff{overflow-x:auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.issues{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;padding:0;list-style:none}
.chip{display:inline-block;font-size:.8125rem;font-weight:600;padding:2px 10px;border-radius:999px;background:var(--mino-bg);color:var(--mino)}
.chip.critical{background:var(--crit-bg);color:var(--crit)}.chip.serious{background:var(--seri-bg);color:var(--seri)}
.chip.moderate{background:var(--mode-bg);color:var(--mode)}
details{margin-top:12px}
summary{cursor:pointer;font-weight:600;color:var(--accent)}
.elements{margin:12px 0 0;padding-left:20px;display:grid;gap:16px}
.elements img{display:block;max-width:100%;height:auto;margin:8px 0;border:1px solid var(--line);border-radius:8px}
code.snippet{display:block;white-space:pre-wrap;word-break:break-all;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-top:6px}
ul.plain{padding-left:20px}
footer{border-top:1px solid var(--line);padding:20px 0 40px;color:var(--ink-2);font-size:.875rem}
`;

function group(g: Report['groups'][number], i: number, cropUrl: (ref: string) => string): string {
  const refs =
    g.kind === 'best-practice'
      ? '<li class="chip">Best practice, not a WCAG requirement</li>'
      : g.refs.map((r) => `<li class="chip">${esc(r)}</li>`).join('');
  const elements = g.instances
    .map(
      (e) => `<li>
<p class="small">On ${pageLink(e.pageUrl)}, element <code>${esc(e.selector)}</code></p>
${e.crop ? `<img src="${esc(cropUrl(e.crop))}" alt="Screenshot of the flagged element on the page" loading="lazy">` : ''}
<code class="snippet">${esc(e.html)}</code>
</li>`,
    )
    .join('\n');
  return `<li class="card">
<h3 id="g${String(i)}">${esc(g.title)}</h3>
<ul class="chips" aria-label="Severity and references">
<li class="chip ${esc(g.impact)}">${esc(IMPACT_LABEL[g.impact] ?? g.impact)}</li>${refs}
</ul>
<p class="small">${plural(g.count, 'element')} flagged.${
    g.fixable ? ' With access to the site’s code, Beacon can propose a tested fix.' : ''
  }</p>
<details>
<summary>Show ${g.count === 1 ? 'the element' : `the ${plural(g.count, 'element')}`}<span class="visually-hidden"> for ${esc(g.title)}</span></summary>
<ol class="elements">
${elements}
</ol>
</details>
</li>`;
}

/** The fixes Beacon proposes (FR-10, D-054): what changes for a screen reader, the diff, the status. */
function fixesSection(fixes: Report['fixes'], cropUrl: (ref: string) => string): string {
  const items = fixes
    .map((f, i) => {
      const announced = f.announced
        ? `<table class="announced"><caption>What a screen reader announces</caption>
<tr><th scope="row">Before</th><td><code>${esc(f.announced.before)}</code></td></tr>
<tr><th scope="row">After</th><td><code>${esc(f.announced.after)}</code></td></tr>
</table>`
        : '';
      return `<li class="card">
<h3 id="fix${String(i)}">${esc(f.title)}</h3>
<ul class="chips" aria-label="Status and risk"><li class="chip">${esc(f.statusLabel)}</li>${f.riskLabel ? `<li class="chip">${esc(f.riskLabel)}</li>` : ''}</ul>
<p class="small">On ${pageLink(f.pageUrl)}, in <code>${esc(f.file)}</code>.${
        f.pr ? ` <a href="${esc(f.pr.url)}">View pull request #${String(f.pr.number)}</a>` : ''
      }</p>
${f.crop ? `<img src="${esc(cropUrl(f.crop))}" alt="Screenshot of the element this fix changes" loading="lazy">` : ''}
${announced}
<p>${esc(f.rationale)}</p>
${
  f.diff
    ? `<details><summary>Show the change<span class="visually-hidden"> for ${esc(f.title)}</span></summary>
<pre class="diff" tabindex="0" aria-label="The change to ${esc(f.file)}"><code>${esc(f.diff)}</code></pre></details>`
    : ''
}
</li>`;
    })
    .join('\n');
  return `<section aria-labelledby="fixes">
<h2 id="fixes">Fixes Beacon proposes</h2>
<p class="note">Beacon tests each fix in a copy of the site before proposing it: the issue must be gone and nothing new may appear. A person approves each fix before it reaches the code.</p>
<ol class="issues">
${items}
</ol>
</section>`;
}

/** The agent's likely issues (D-048): each needs a human, and every suggestion is untested. */
function reviewSection(
  review: NonNullable<Report['review']>,
  cropUrl: (ref: string) => string,
): string {
  const items = review.flags
    .map(
      (f) => `<li class="card">
<h3>${esc(f.title)}</h3>
<ul class="chips" aria-label="Status"><li class="chip">Needs a human to confirm</li></ul>
<p class="small">On ${pageLink(f.pageUrl)}. ${esc(f.label)} now: <q>${esc(f.current)}</q></p>
${f.crop ? `<img src="${esc(cropUrl(f.crop))}" alt="Screenshot of the image on the page" loading="lazy">` : ''}
<p>${esc(f.reason)}</p>
<p class="suggestion"><span class="suggestion-label">Suggestion, not tested on your site:</span> ${esc(f.suggestion)}</p>
</li>`,
    )
    .join('\n');
  const notReviewed = review.notReviewed.length
    ? `<p class="small">The agent review did not finish on ${plural(review.notReviewed.length, 'page')}: ${review.notReviewed.map(pageLink).join(', ')}.</p>`
    : '';
  return `<section aria-labelledby="likely">
<h2 id="likely">Likely issues the agent noticed</h2>
<p class="note">An AI agent looked at images and links that automated rules cannot judge, on ${plural(review.reviewedPages, 'page')}. Each item needs a human to confirm it, and each suggestion is untested on your site.</p>
${
  review.flags.length
    ? `<ol class="issues">\n${items}\n</ol>`
    : '<p>The agent flagged nothing on the pages it reviewed.</p>'
}
${notReviewed}
</section>`;
}

export function renderReport(report: Report, options: RenderOptions): string {
  const site = host(options.siteUrl);
  const t = report.totals;
  const stats = (['critical', 'serious', 'moderate', 'minor'] as const)
    .map((k) => `<div><dt>${IMPACT_LABEL[k] ?? k}</dt><dd>${String(t.byImpact[k])}</dd></div>`)
    .join('');
  const issues =
    report.groups.length === 0
      ? '<p>No issues were flagged on the scanned pages. That does not mean the pages have no barriers: see what this report does not cover.</p>'
      : `<ol class="issues">\n${report.groups.map((g, i) => group(g, i, options.cropUrl)).join('\n')}\n</ol>`;
  const notScanned =
    report.notScanned.length === 0
      ? ''
      : `<h3>Pages not scanned</h3>
<ul class="plain">${report.notScanned.map((p) => `<li>${pageLink(p.url)}: ${esc(p.reason)}</li>`).join('')}</ul>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Accessibility report for ${esc(site)}</title>
<style>${CSS}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}</style>
</head>
<body>
<header class="top"><div class="wrap"><p>Beacon</p></div></header>
<main class="wrap">
<h1>Possible accessibility barriers on ${esc(site)}</h1>
<p class="meta">Scanned ${day(options.scannedAt)}, ${plural(t.pagesScanned, 'page')}. This link expires on ${day(options.expiresAt)}.</p>

<section aria-labelledby="summary">
<h2 id="summary">Summary</h2>
<p>Automated checks flagged ${plural(t.issues, 'element')} in ${plural(report.groups.length, 'kind', 'kinds')} of issue.</p>${
    report.review
      ? `\n<p>An AI agent also noticed ${plural(report.review.flags.length, 'likely issue')} for a human to confirm.</p>`
      : ''
  }
<dl class="stats">${stats}</dl>
<p class="note">${esc(report.coverage.summary)}</p>
</section>

${report.fixes.length ? fixesSection(report.fixes, options.cropUrl) : ''}

<section aria-labelledby="found">
<h2 id="found">What the checks found</h2>
${issues}
</section>

${report.review ? reviewSection(report.review, options.cropUrl) : ''}

<section aria-labelledby="coverage">
<h2 id="coverage">What this report covers</h2>
<h3>Checked</h3>
<ul class="plain">${report.coverage.checked.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
<h3>Not checked</h3>
<ul class="plain">${report.coverage.notChecked.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
${notScanned}
</section>
</main>
<footer><div class="wrap">Beacon reports what automated checks found. It is not a legal audit and does not replace testing with disabled people.</div></footer>
</body>
</html>
`;
}
