// The fix step of a run (v1.0 §9.1 step 6, §9.2; FR-07, FR-08, NFR-03; D-039): claim each queued job,
// run the fix job on the stored page and the checkout, save its proposal and finish the job, then mark
// the run ready. The model runs outside any transaction; saving and finishing share one.
import type { FixerLimits, LlmClient } from '@beacon/agent';
import type { Clock, IdGen } from '@beacon/core';
import { asApp, claimFixJob, finishFixJob, loadFixJob, saveProposal, type Sql } from '@beacon/db';
import type { Finding } from '@beacon/scanner';
import type { SiteFiles } from '@beacon/verifier';
import type { Browser } from 'playwright';
import { runFixJob, type FixJobResult } from './fix-job.ts';

export type FixRunDeps = {
  sql: Sql;
  browser: Browser;
  llm: LlmClient;
  clock: Clock;
  ids: IdGen;
  limits?: FixerLimits;
};

/** A model error is transient (v1.0 §9.2: one retry); every other outcome is a finished job. */
const transient = (r: FixJobResult) =>
  r.kind === 'no_proposal' && r.fixer.kind === 'failed' && r.fixer.reason === 'LLM_ERROR';

export async function runFixJobs(
  deps: FixRunDeps,
  {
    orgId,
    runId,
    site,
  }: { orgId: string; runId: string; site: { files: SiteFiles; commitSha: string } },
): Promise<void> {
  const app = <T>(fn: Parameters<typeof asApp<T>>[2]) => asApp(deps.sql, orgId, fn);
  for (;;) {
    const job = await app((tx) => claimFixJob(tx, { runId }));
    if (!job) break;
    const attempt = job.attempts;
    try {
      const input = await app((tx) => loadFixJob(tx, { runId, fingerprint: job.fingerprint }));
      const result = await runFixJob(deps, {
        runId,
        site,
        page: input.page,
        finding: input.finding as Finding, // stored from the scanner's own Finding (D-038)
      });
      await app(async (tx) => {
        if (result.kind === 'proposal')
          await saveProposal(tx, {
            orgId,
            findingId: input.findingId,
            proposal: result.proposal,
            status: result.status,
          });
        // false: the lease ran out and another worker holds the job; the save above is idempotent.
        await finishFixJob(tx, {
          id: job.id,
          attempt,
          outcome: transient(result) ? 'error' : 'done',
        });
      });
    } catch {
      // shortcut: the error itself is not recorded yet; the run trace (NFR-08) will carry it.
      await app((tx) => finishFixJob(tx, { id: job.id, attempt, outcome: 'error' }));
    }
  }
  await app((tx) => tx`update scan_runs set status = 'ready' where id = ${runId}`);
}
