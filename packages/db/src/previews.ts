// Fix previews (FR-29, D-056). Callers pass a transaction that runs as the app role with app.org_id
// set. One preview per finding: a retried step adds nothing.
import { parseBlobRef } from '@beacon/core';
import type { TransactionSql } from 'postgres';

export type FixPreviewRow = {
  ruleId: string;
  title: string;
  rationale: string;
  /** The element as served now, and as the fix would make it (page content: shown escaped). */
  before: string;
  after: string;
  announcedBefore: string | null;
  announcedAfter: string | null;
  /** The verifier passed it on the copy of the live page. */
  verified: boolean;
  crop: string | null;
};

export async function savePreview(
  tx: TransactionSql,
  {
    orgId,
    runId,
    findingId,
    preview: p,
  }: { orgId: string; runId: string; findingId: string; preview: FixPreviewRow },
): Promise<void> {
  if (p.crop !== null) parseBlobRef(p.crop); // only blob refs reach the table
  await tx`
    insert into fix_previews (org_id, run_id, finding_id, rule_id, title, rationale, before_html,
      after_html, announced_before, announced_after, verified, crop)
    values (${orgId}, ${runId}, ${findingId}, ${p.ruleId}, ${p.title}, ${p.rationale}, ${p.before},
      ${p.after}, ${p.announcedBefore}, ${p.announcedAfter}, ${p.verified}, ${p.crop})
    on conflict (finding_id) do nothing`;
}
