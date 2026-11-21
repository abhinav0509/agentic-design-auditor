// Exports (FR-14, FR-16, D-053): the run's approved proposals for the exporter, and its outcome
// written back through the state machine. Callers pass a transaction that runs as the app role with
// app.org_id set. Writes are idempotent: a retried outcome finds nothing left to move.
import {
  parseProposal,
  transition,
  type Proposal,
  type PullRequest,
  type Status,
} from '@beacon/core';
import type { TransactionSql } from 'postgres';

export type ExportOutcome =
  | { status: 'pr_open'; branch: string; pr: PullRequest; proposalIds: string[] }
  | { status: 'apply_failed'; proposalIds: string[] };

/** Approved proposals of a run, in id order, with the engine rule the verifier re-checks. */
export async function loadApproved(
  tx: TransactionSql,
  runId: string,
): Promise<{ proposal: Proposal; engineRule: string; version: number }[]> {
  const rows = await tx<
    { payload: unknown; engine_rule: string | null; rule_id: string; version: number }[]
  >`
    select p.payload, f.engine_rule, f.rule_id, p.version
    from proposals p join findings f on f.id = p.finding_id
    where p.run_id = ${runId} and p.status = 'approved'
    order by p.id`;
  return rows.map((r) => ({
    proposal: parseProposal(r.payload),
    engineRule: r.engine_rule ?? r.rule_id,
    version: r.version,
  }));
}

/** Moves each still-approved proposal to `to`, with a system event; already-moved ones are skipped. */
async function move(
  tx: TransactionSql,
  orgId: string,
  ids: string[],
  to: Status,
  at: string,
  reason?: string,
): Promise<void> {
  for (const id of ids) {
    const [p] = await tx<{ status: Status; version: number }[]>`
      select status, version from proposals where id = ${id} for update`;
    if (!p || p.status !== 'approved') continue;
    const { state, event } = transition({ id, status: p.status, version: p.version }, to, {
      actor: { type: 'system', id: null },
      at,
      ...(reason ? { reason } : {}),
    });
    await tx`update proposals set status = ${state.status}, version = ${state.version} where id = ${id}`;
    await tx`
      insert into proposal_events (org_id, proposal_id, from_status, to_status, actor_type, actor_id, reason)
      values (${orgId}, ${id}, ${event.from_status}, ${event.to_status}, ${event.actor_type},
        ${event.actor_id}, ${event.reason})`;
  }
}

export async function recordExport(
  tx: TransactionSql,
  {
    orgId,
    runId,
    outcome,
    at,
  }: { orgId: string; runId: string; outcome: ExportOutcome; at: string },
): Promise<void> {
  if (outcome.status === 'apply_failed') {
    await move(tx, orgId, outcome.proposalIds, 'apply_failed', at, 'the patch no longer applies');
    return;
  }
  const [run] = await tx<{ site_id: string }[]>`select site_id from scan_runs where id = ${runId}`;
  if (!run) throw new Error(`no run ${runId}`);
  await tx`
    insert into exports (org_id, site_id, kind, branch, pr_number, pr_url, proposal_ids, status)
    values (${orgId}, ${run.site_id}, 'pull_request', ${outcome.branch}, ${outcome.pr.number},
      ${outcome.pr.url}, ${outcome.proposalIds}::uuid[], 'pr_open')
    on conflict (site_id, branch) do nothing`;
  await move(tx, orgId, outcome.proposalIds, 'applied', at, `PR ${outcome.pr.url}`);
}
