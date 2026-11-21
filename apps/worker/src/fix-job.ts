// The fix job (v1.0 §9.1 steps 5-6, §9.2, §9.4; D-034): one scan finding -> mapper -> bounded fixer
// over the checkout -> verifier -> proposal. Only a mapped, locally reproduced, verified patch can be
// pending (FR-08); everything else is unmapped, no proposal, or a proposal that says why it is not.
import {
  PROMPT_VERSION,
  runFixer,
  type FixerJob,
  type FixerLimits,
  type FixerResult,
  type FixerTools,
  type LlmClient,
} from '@beacon/agent';
import {
  buildProposal,
  parseNodes,
  type BuildInput,
  type BlobStore,
  type Clock,
  type IdGen,
  type Proposal,
  type Status,
} from '@beacon/core';
import { mapFinding, repoPathOf, type UnmappedReason } from '@beacon/mapper';
import type { Finding } from '@beacon/scanner';
import { verify, type SiteFiles } from '@beacon/verifier';
import { createHash } from 'node:crypto';
import type { Browser } from 'playwright';

export type FixJobResult =
  | { kind: 'unmapped'; reason: UnmappedReason | 'UNMAPPED_LOCAL_MISMATCH' }
  | { kind: 'no_proposal'; fixer: FixerResult }
  | {
      kind: 'proposal';
      proposal: Proposal;
      status: Status;
      fixer: FixerResult;
      /** What assistive technology announces before and after, when the verifier rendered it. */
      announced?: { before: string; after: string };
    };

const SEARCH_LIMIT = 20;
/**
 * The image type from its first bytes: the vision input accepts these four. A file's extension can
 * lie (a crop of the live page is a PNG whatever the src says); SVG and anything else are refused.
 */
function imageType(b: Uint8Array): string | undefined {
  const at = (i: number, ...bytes: number[]) => bytes.every((v, k) => b[i + k] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return undefined;
}

const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

/** Read-only fixer tools over the checkout in memory; nothing of the repo is ever run (D-008). */
export function siteTools(
  files: SiteFiles,
  finding: { pageUrl: string; snippet: string },
  /** The site's base URL, when the repo root is served under a path (a project site). */
  siteUrl?: string,
): FixerTools {
  const text = (path: string) => {
    const f = files[path];
    if (f === undefined) throw new Error(`no file ${path}`);
    if (typeof f !== 'string') throw new Error(`${path} is not a text file`);
    return f;
  };
  return {
    readFile: (path, range) =>
      Promise.resolve().then(() => {
        const s = text(path);
        return range
          ? s
              .split('\n')
              .slice(range.start - 1, range.end)
              .join('\n')
          : s;
      }),
    searchSource: (query) =>
      Promise.resolve(
        Object.keys(files)
          .sort()
          .flatMap((path) => {
            const f = files[path];
            return typeof f === 'string'
              ? f
                  .split('\n')
                  .flatMap((l, i) => (l.includes(query) ? [`${path}:${String(i + 1)}: ${l}`] : []))
              : [];
          })
          .slice(0, SEARCH_LIMIT)
          .join('\n'),
      ),
    getDomSnippet: () => Promise.resolve(finding.snippet),
    getImage: () =>
      Promise.resolve().then(() => {
        // shortcut: reads src from the engine's outerHTML snippet, which always double-quotes; only &amp; is decoded.
        const src = /\ssrc="([^"]*)"/.exec(finding.snippet)?.[1]?.replaceAll('&amp;', '&');
        const path =
          src === undefined ? undefined : repoPathOf(new URL(src, finding.pageUrl), siteUrl);
        const data = path === undefined ? undefined : files[path];
        const mediaType = data instanceof Uint8Array ? imageType(data) : undefined;
        if (!(data instanceof Uint8Array) || !mediaType)
          throw new Error('the image could not be loaded');
        return { mediaType, data: Buffer.from(data).toString('base64') };
      }),
  };
}

/** Whether the element whose start tag begins at `at` sits inside a <form> (raises risk, §6.3). */
function insideForm(source: string, at: number) {
  const el = parseNodes(source).nodes.find(
    (n) => n.kind === 'element' && n.element.sourceCodeLocation?.startTag?.startOffset === at,
  );
  for (
    let p = el?.kind === 'element' ? el.element.parentNode : null;
    p;
    p = 'parentNode' in p ? p.parentNode : null
  )
    if ('tagName' in p && p.tagName === 'form') return true;
  return false;
}

export async function runFixJob(
  deps: {
    browser: Browser;
    llm: LlmClient;
    clock: Clock;
    ids: IdGen;
    limits?: FixerLimits;
    blobs?: BlobStore;
  },
  input: {
    runId: string;
    /** url: the site's base URL, when the repo root is served under a path (a project site). */
    site: { files: SiteFiles; commitSha: string; url?: string };
    /** The page as the scan fetched it: its HTML and its visible text. */
    page: { url: string; served: string; text: string };
    finding: Finding;
  },
): Promise<FixJobResult> {
  const { finding, page, site } = input;
  const map = mapFinding({
    files: site.files,
    pageUrl: page.url,
    ...(site.url ? { siteUrl: site.url } : {}),
    served: page.served,
    finding,
  });
  if (!map.mapped) return { kind: 'unmapped', reason: map.reason };
  const source = site.files[map.file] as string; // the mapper maps only text files

  const job: FixerJob = {
    finding: {
      ruleId: finding.rule_id,
      impact: finding.impact,
      selector: finding.target,
      snippet: finding.html,
      pageUrl: page.url,
      pageText: page.text,
      at: map.at,
    },
    file: { path: map.file, source, baseHash: sha(source) },
    context: {
      pageUrl: page.url,
      insideForm: insideForm(source, map.at),
      decorativeAgreed: false,
      visualDiffRatio: 0,
    },
  };
  const fixer = await runFixer({
    llm: deps.llm,
    job,
    tools: siteTools(site.files, { pageUrl: page.url, snippet: finding.html }, site.url),
    ...(deps.limits ? { limits: deps.limits } : {}),
  });
  if (fixer.kind === 'blocked' || fixer.kind === 'failed') return { kind: 'no_proposal', fixer };

  let result: BuildInput['result'];
  let announced: { before: string; after: string } | undefined;
  let crop: string | null = null;
  if (fixer.kind === 'patch') {
    // shortcut: reproduction is checked after the model run, so a finding that does not reproduce
    // locally still costs one fixer run; check it first if that shows up in cost reports.
    const v = await verify(
      deps.browser,
      { files: site.files, page: map.file, finding, patch: { path: map.file, after: fixer.after } },
      { evidence: true },
    );
    if (v.status === 'unmapped') return { kind: 'unmapped', reason: v.code };
    if (v.evidence) {
      announced = { before: v.evidence.before, after: v.evidence.after };
      if (v.evidence.crop && deps.blobs) crop = await deps.blobs.put(v.evidence.crop, 'image/png');
    }
    const { title, rationale, confidence, ops, after } = fixer;
    result = { kind: 'patch', title, rationale, confidence, ops, after, verification: v };
  } else result = fixer;

  const built = buildProposal(
    {
      runId: input.runId,
      agent: { name: 'beacon-fixer', version: PROMPT_VERSION },
      finding: {
        ruleId: finding.rule_id,
        impact: finding.impact,
        selector: finding.target,
        pageUrl: page.url,
      },
      file: { ...job.file, commitSha: site.commitSha },
      context: job.context,
      screenshots: { before: null, after: crop },
      result,
    },
    deps,
  );
  return { kind: 'proposal', ...built, fixer, ...(announced ? { announced } : {}) };
}
