// Export a run (FR-14, FR-25, D-053): the run's approved proposals through the exporter (D-040),
// with every proposal's finding re-verified on the batch's combined change against a fresh checkout
// of the default branch head, then the outcome written back through the state machine.
import type { Clock, GitProvider } from '@beacon/core';
import { asApp, loadApproved, recordExport, type Sql } from '@beacon/db';
import { exportBatch, type ExportResult } from '@beacon/exporter';
import { verify, type SiteFiles } from '@beacon/verifier';
import type { Browser } from 'playwright';

export async function exportRun(
  deps: {
    sql: Sql;
    browser: Browser;
    git: GitProvider;
    /** The files of a commit (GitHub: `checkout`); nothing in them is ever run (D-008). */
    checkout: (sha: string) => Promise<SiteFiles>;
    clock: Clock;
  },
  { orgId, runId }: { orgId: string; runId: string },
): Promise<ExportResult | { status: 'nothing_to_export' }> {
  const approved = await asApp(deps.sql, orgId, (tx) => loadApproved(tx, runId));
  if (approved.length === 0) return { status: 'nothing_to_export' };

  const result = await exportBatch(
    {
      git: deps.git,
      // FR-25: the batch as a whole. Each finding must be fixed, with nothing new, on the combined files.
      verify: async (changed) => {
        const head = await deps.git.headSha(await deps.git.defaultBranch());
        if (head === null) return { ok: false };
        const base = await deps.checkout(head);
        const combined: SiteFiles = { ...base };
        for (const f of changed) combined[f.path] = f.content;
        for (const { proposal, engineRule } of approved) {
          const path = proposal.target.file;
          const after = combined[path];
          if (typeof after !== 'string') return { ok: false };
          const v = await verify(deps.browser, {
            files: base,
            page: path,
            finding: { engine_rule: engineRule, target: proposal.target.selector },
            patch: { path, after },
          });
          if (v.status !== 'passed') return { ok: false };
        }
        return { ok: true };
      },
    },
    { runId, proposals: approved.map((a) => a.proposal) },
  );

  const at = deps.clock.now().toISOString();
  const ids = approved.map((a) => a.proposal.proposal_id);
  if (result.status === 'pr_open')
    await asApp(deps.sql, orgId, (tx) =>
      recordExport(tx, {
        orgId,
        runId,
        outcome: { status: 'pr_open', branch: result.branch, pr: result.pr, proposalIds: ids },
        at,
      }),
    );
  if (result.status === 'apply_failed')
    await asApp(deps.sql, orgId, (tx) =>
      recordExport(tx, {
        orgId,
        runId,
        outcome: { status: 'apply_failed', proposalIds: result.proposalIds },
        at,
      }),
    );
  return result;
}
