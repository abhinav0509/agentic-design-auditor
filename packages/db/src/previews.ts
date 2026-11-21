import type { TransactionSql } from 'postgres';
export type FixPreviewRow = {
  ruleId: string;
  title: string;
  rationale: string;
  before: string;
  after: string;
  announcedBefore: string | null;
  announcedAfter: string | null;
  verified: boolean;
  crop: string | null;
};
export function savePreview(
  _tx: TransactionSql,
  _i: { orgId: string; runId: string; findingId: string; preview: FixPreviewRow },
): Promise<void> {
  return Promise.reject(new Error('not implemented'));
}
