// Undo a fix (FR-15, D-058): find the PR the fix went into, revert it on that branch (open PR) or
// open a revert PR (merged), and record the fix as reverted with the reviewer who asked. A paused
// org undoes nothing (FR-28): undo writes to GitHub like an export.
import type { Clock, GitProvider } from '@beacon/core';
import { agentPaused, asApp, loadUndo, recordUndo, type Sql } from '@beacon/db';
import { undoProposal, type UndoResult } from '@beacon/exporter';

export async function undoFix(
  deps: { sql: Sql; git: GitProvider; clock: Clock },
  { orgId, proposalId, userId }: { orgId: string; proposalId: string; userId: string },
): Promise<UndoResult | { status: 'paused' } | { status: 'not_applied' }> {
  const app = <T>(fn: Parameters<typeof asApp<T>>[2]) => asApp(deps.sql, orgId, fn);
  if (await app((tx) => agentPaused(tx))) return { status: 'paused' };
  const fix = await app((tx) => loadUndo(tx, proposalId));
  if (!fix?.pr || (fix.status !== 'applied' && fix.status !== 'merged'))
    return { status: 'not_applied' };
  const { pr } = fix;

  const result = await undoProposal(deps.git, { runId: fix.runId, proposal: fix.proposal, pr });
  if (result.status !== 'no_longer_applies')
    await app((tx) =>
      recordUndo(tx, {
        orgId,
        runId: fix.runId,
        proposalId,
        userId,
        at: deps.clock.now().toISOString(),
        ...(result.status === 'revert_pr_open'
          ? { revertPr: { branch: result.branch, pr: result.pr } }
          : {}),
      }),
    );
  return result;
}
