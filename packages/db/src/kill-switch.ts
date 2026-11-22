// The org kill switch (FR-28, D-057). Callers pass a transaction that runs as the app role with
// app.org_id set, so each call reads or sets the current org only (organizations is under RLS).
import type { TransactionSql } from 'postgres';

/** Whether agent work is paused for the current org. */
export async function agentPaused(tx: TransactionSql): Promise<boolean> {
  const [row] = await tx<{ paused: boolean }[]>`
    select agent_paused_at is not null as paused from organizations where id = app_org_id()`;
  return row?.paused ?? false;
}

/** Pauses or resumes agent work for the current org. */
export async function setAgentPaused(
  tx: TransactionSql,
  { paused, at, reason }: { paused: boolean; at: Date; reason?: string },
): Promise<void> {
  await tx`
    update organizations
    set agent_paused_at = ${paused ? at : null}, agent_paused_reason = ${paused ? (reason ?? null) : null}
    where id = app_org_id()`;
}
