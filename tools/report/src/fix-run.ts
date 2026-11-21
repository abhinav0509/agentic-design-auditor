// Operator approval and export for a fix run (FR-11, FR-14, D-054), addressed by the run's report
// link. Approval goes through decideProposal (D-051) as the operator user; the export through
// exportRun (D-053). Both are safe to repeat: approvals replay by key, exports find nothing to move.
import type { Clock, GitProvider } from '@beacon/core';
import { asApp, decideProposal, ensureOperator, resolveReportLink, type Sql } from '@beacon/db';
import type { SiteFiles } from '@beacon/verifier';
import { exportRun } from '@beacon/worker';
import type { Browser } from 'playwright';

async function runOf(sql: Sql, token: string, now: Date) {
  const link = await resolveReportLink(sql, token, now);
  if (!link) throw new Error('no run for that report link: it is unknown, expired or revoked');
  return link;
}

/** Approves the run's waiting fixes, all or by their number in the list (1-based, in id order). */
export async function approveFixes(
  deps: { sql: Sql; clock: Clock },
  {
    token,
    operatorEmail,
    which,
  }: { token: string; operatorEmail: string; which: 'all' | number[] },
): Promise<{ n: number; title: string; status: string }[]> {
  const now = deps.clock.now();
  const { orgId, runId } = await runOf(deps.sql, token, now);
  const operator = await ensureOperator(deps.sql, { orgId, email: operatorEmail });
  return asApp(deps.sql, orgId, async (tx) => {
    const waiting = await tx<{ id: string; version: number; title: string }[]>`
      select id, version, payload->>'title' as title from proposals
      where run_id = ${runId} and status = 'pending' and kind = 'patch' order by id`;
    const chosen = waiting
      .map((p, i) => ({ ...p, n: i + 1 }))
      .filter((p) => which === 'all' || which.includes(p.n));
    const done: { n: number; title: string; status: string }[] = [];
    for (const p of chosen) {
      const r = await decideProposal(tx, {
        orgId,
        proposalId: p.id,
        userId: operator,
        // One key per proposal version, so running the same approval again replays it.
        input: {
          action: 'approve',
          key: `operator-approve-v${String(p.version)}`,
          expectedVersion: p.version,
        },
        at: now.toISOString(),
      });
      done.push({ n: p.n, title: p.title, status: r.state.status });
    }
    return done;
  });
}

/** Exports the run's approved fixes as one verified pull request. */
export async function exportFixes(
  deps: {
    sql: Sql;
    browser: Browser;
    git: GitProvider;
    checkout: (sha: string) => Promise<SiteFiles>;
    clock: Clock;
  },
  token: string,
) {
  const { orgId, runId } = await runOf(deps.sql, token, deps.clock.now());
  return exportRun(deps, { orgId, runId });
}
