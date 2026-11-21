// Fix previews from the URL alone (FR-29, D-056): the URL-only report shows the fix Beacon would make
// for each fixable finding, without the client's code. Each fix job runs on a one-page "checkout"
// built from the live page: the HTML as served, and the scan's crop of an image under that image's
// path, so the fixer can see it. The verifier checks the fix on that copy. Nothing is a proposal:
// applying a fix needs the site's code, which comes after the client agrees (repo access).
import type { FixerLimits, LlmClient } from '@beacon/agent';
import type { BlobStore, Clock, IdGen } from '@beacon/core';
import { asApp, claimFixJob, finishFixJob, loadFixJob, savePreview, type Sql } from '@beacon/db';
import { repoPathOf } from '@beacon/mapper';
import type { Finding } from '@beacon/scanner';
import type { SiteFiles } from '@beacon/verifier';
import { createHash } from 'node:crypto';
import type { Browser } from 'playwright';
import { runFixJob, type FixJobResult } from './fix-job.ts';

/** The file name a static host would serve for this URL: what the mapper looks for. */
function pageFile(url: string): string {
  const path = repoPathOf(new URL(url)) ?? '';
  if (path === '' || path.endsWith('/')) return `${path}index.html`;
  return path.endsWith('.html') ? path : `${path}.html`;
}

/** The changed lines of a one-hunk diff: what the element is now and what the fix makes it. */
function beforeAfter(diff: string): { before: string; after: string } {
  const lines = diff.split('\n');
  const pick = (sign: string) =>
    lines
      .filter((l) => l.startsWith(sign) && !l.startsWith(`${sign}${sign}${sign}`))
      .map((l) => l.slice(1))
      .join('\n');
  return { before: pick('-'), after: pick('+') };
}

const transient = (r: FixJobResult) =>
  r.kind === 'no_proposal' && r.fixer.kind === 'failed' && r.fixer.reason === 'LLM_ERROR';

export async function previewFixes(
  deps: {
    sql: Sql;
    browser: Browser;
    llm: LlmClient;
    clock: Clock;
    ids: IdGen;
    blobs: BlobStore;
    limits?: FixerLimits;
  },
  { orgId, runId }: { orgId: string; runId: string },
): Promise<void> {
  const app = <T>(fn: Parameters<typeof asApp<T>>[2]) => asApp(deps.sql, orgId, fn);
  for (;;) {
    const job = await app((tx) => claimFixJob(tx, { runId }));
    if (!job) break;
    const attempt = job.attempts;
    try {
      const input = await app((tx) => loadFixJob(tx, { runId, fingerprint: job.fingerprint }));
      const [stored] = await app(
        (tx) =>
          tx<{ crop: string | null }[]>`
          select evidence->>'crop' as crop from findings where id = ${input.findingId}`,
      );
      const files: SiteFiles = { [pageFile(input.page.url)]: input.page.served };
      // The fixer sees an image through the scan's crop of it on the live page.
      const src = /\ssrc="([^"]*)"/.exec(input.finding.html)?.[1]?.replaceAll('&amp;', '&');
      const crop = stored?.crop ? await deps.blobs.get(stored.crop) : null;
      const imagePath = src === undefined ? undefined : repoPathOf(new URL(src, input.page.url));
      if (crop && imagePath) files[imagePath] = crop;

      const result = await runFixJob(deps, {
        runId,
        // The served HTML's hash stands in for a commit: the content the fix was made against.
        site: {
          files,
          commitSha: createHash('sha1').update(input.page.served).digest('hex'),
        },
        page: input.page,
        finding: input.finding as Finding,
      });
      await app(async (tx) => {
        if (result.kind === 'proposal' && result.proposal.change) {
          const p = result.proposal;
          await savePreview(tx, {
            orgId,
            runId,
            findingId: input.findingId,
            preview: {
              ruleId: p.rule.id,
              title: p.title,
              rationale: p.rationale,
              ...beforeAfter(p.change.diff),
              announcedBefore: result.announced?.before ?? null,
              announcedAfter: result.announced?.after ?? null,
              verified: result.status === 'pending',
              crop: p.evidence.after_screenshot,
            },
          });
        }
        await finishFixJob(tx, {
          id: job.id,
          attempt,
          outcome: transient(result) ? 'error' : 'done',
        });
      });
    } catch (e) {
      // shortcut: the error itself is not stored yet (D-039); the job is retried once, then failed.
      console.error(e);
      await app((tx) => finishFixJob(tx, { id: job.id, attempt, outcome: 'error' }));
    }
  }
  await app((tx) => tx`update scan_runs set status = 'ready' where id = ${runId}`);
}
