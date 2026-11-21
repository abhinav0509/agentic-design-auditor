// The scan step of a run (v1.0 §9.1 steps 1-4 and 6, FR-05, D-038): each page through the guarded
// browser into Postgres, then the run moves on to fixing. The caller owns the BrowserContext, so the
// sandbox, egress proxy and in-app guard (D-017, D-020) are set up there.
import { runReviewer, type LlmClient, type Usage } from '@beacon/agent';
import { DomainError, type BlobStore } from '@beacon/core';
import {
  asApp,
  recordModelUsage,
  savePageError,
  savePageReview,
  savePageScan,
  type ReviewFlagRow,
  type Sql,
} from '@beacon/db';
import { scanPageContent, type PageContent } from '@beacon/scanner';
import type { BrowserContext } from 'playwright';

/** The MVP page limit per run (FR-05). */
const MAX_PAGES = 10;

/**
 * The review agent on one page's candidates (D-046, D-048). Flagged images keep their crop as
 * evidence. `flags` is null when the review did not finish: the page then stays unreviewed.
 */
async function reviewPage(
  llm: LlmClient,
  blobs: BlobStore | undefined,
  url: string,
  page: PageContent,
): Promise<{ flags: ReviewFlagRow[] | null; usage: Usage }> {
  const { candidates, images } = page.review;
  const png = (id: string) => images.find((i) => i.id === id)?.png;
  const result = await runReviewer({
    llm,
    job: { pageUrl: url, candidates },
    tools: {
      getImage: (id) => {
        const bytes = png(id);
        return bytes
          ? Promise.resolve({ mediaType: 'image/png', data: Buffer.from(bytes).toString('base64') })
          : Promise.reject(new Error('the image could not be captured'));
      },
    },
  });
  if (result.kind !== 'done') return { flags: null, usage: result.usage };
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const flags: ReviewFlagRow[] = [];
  for (const f of result.flags) {
    const c = byId.get(f.id);
    if (!c) continue; // the reviewer refuses unknown ids; this keeps the types honest
    const bytes = c.kind === 'image' ? png(c.id) : undefined;
    flags.push({
      candidate: c.kind,
      kind: f.kind,
      selector: c.selector,
      text: c.kind === 'image' ? c.alt : c.text,
      reason: f.reason,
      suggestion: f.suggestion,
      crop: bytes && blobs ? await blobs.put(bytes, 'image/png') : null,
    });
  }
  return { flags, usage: result.usage };
}

export async function scanRun(
  /** Without a blob store, no element crops are taken. */
  deps: { sql: Sql; context: BrowserContext; blobs?: BlobStore; reviewer?: { llm: LlmClient } },
  { orgId, runId, urls }: { orgId: string; runId: string; urls: string[] },
): Promise<void> {
  if (urls.length > MAX_PAGES)
    throw new DomainError('TOO_MANY_PAGES', `a run scans at most ${String(MAX_PAGES)} pages`);
  // A resumed run skips the pages it already stored (NFR-03).
  const stored = new Set(
    (
      await asApp(
        deps.sql,
        orgId,
        (tx) => tx<{ url: string }[]>`
        select url from pages where run_id = ${runId}`,
      )
    ).map((p) => p.url),
  );
  for (const url of urls.filter((u) => !stored.has(u))) {
    let page;
    try {
      page = await scanPageContent(deps.context, url, {
        crops: deps.blobs !== undefined,
        review: deps.reviewer !== undefined,
      });
    } catch (e) {
      // v1.0 §12.3: the page is listed as not scanned with its reason; the run goes on.
      const reason = e instanceof DomainError ? e.code : 'SCAN_FAILED';
      await asApp(deps.sql, orgId, (tx) => savePageError(tx, { orgId, runId, url, reason }));
      continue;
    }
    const { served, text, findings, reported } = page;
    // Crops go to the store before the rows that point at them, so a stored ref always resolves.
    const crops: Record<string, string> = {};
    for (const c of page.crops) {
      if (deps.blobs) crops[c.target] = await deps.blobs.put(c.png, 'image/png');
    }
    const review = deps.reviewer
      ? await reviewPage(deps.reviewer.llm, deps.blobs, url, page)
      : null;
    // The page, its flags and the model cost commit together, so a resumed run (which skips stored
    // pages) never reviews or charges a page twice.
    await asApp(deps.sql, orgId, async (tx) => {
      await savePageScan(tx, { orgId, runId, url, served, text, findings, reported, crops });
      if (review?.flags)
        await savePageReview(tx, { orgId, runId, url, flags: review.flags, usage: review.usage });
      else if (review) await recordModelUsage(tx, { orgId, runId, usage: review.usage });
    });
  }
  await asApp(
    deps.sql,
    orgId,
    (tx) => tx`update scan_runs set status = 'fixing' where id = ${runId}`,
  );
}
