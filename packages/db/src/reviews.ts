// Agent review results (FR-29, NFR-05, D-048). Callers pass a transaction that already runs as the
// app role with app.org_id set; the scan step saves a page and its review in one transaction.
import { parseBlobRef } from '@beacon/core';
import type { TransactionSql } from 'postgres';

export type ReviewFlagRow = {
  candidate: 'image' | 'link';
  kind: 'unhelpful_alt' | 'vague_link';
  selector: string;
  /** The alt or link text as found on the page (untrusted page content). */
  text: string;
  reason: string;
  /** Not tested on the site; shown as a suggestion only. */
  suggestion: string;
  crop: string | null;
};

/**
 * Saves a stored page's review flags and records the model cost in the usage ledger, once: a page
 * already marked reviewed is left alone and the call returns false.
 */
export async function savePageReview(
  tx: TransactionSql,
  input: {
    orgId: string;
    runId: string;
    url: string;
    flags: ReviewFlagRow[];
    usage: { inputTokens: number; outputTokens: number; costMicros: number };
  },
): Promise<boolean> {
  const { orgId, runId, url, flags, usage } = input;
  for (const f of flags) if (f.crop !== null) parseBlobRef(f.crop); // only blob refs reach the table
  const [page] = await tx<{ id: string }[]>`
    update pages set reviewed_at = now()
    where run_id = ${runId} and url = ${url} and reviewed_at is null
    returning id`;
  if (!page) return false;
  for (const f of flags) {
    await tx`
      insert into review_flags (org_id, run_id, page_id, candidate, kind, selector, current_text,
        reason, suggestion, crop)
      values (${orgId}, ${runId}, ${page.id}, ${f.candidate}, ${f.kind}, ${f.selector}, ${f.text},
        ${f.reason}, ${f.suggestion}, ${f.crop})
      on conflict (page_id, selector, kind) do nothing`;
  }
  await recordModelUsage(tx, { orgId, runId, usage });
  return true;
}

/** Records model tokens and cost against a run (NFR-05); a call that used nothing records nothing. */
export async function recordModelUsage(
  tx: TransactionSql,
  {
    orgId,
    runId,
    usage,
  }: {
    orgId: string;
    runId: string;
    usage: { inputTokens: number; outputTokens: number; costMicros: number };
  },
): Promise<void> {
  const units = usage.inputTokens + usage.outputTokens;
  if (units === 0 && usage.costMicros === 0) return;
  await tx`
    insert into usage_ledger (org_id, run_id, kind, units, cost_micros)
    values (${orgId}, ${runId}, 'model', ${units}, ${usage.costMicros})`;
}
