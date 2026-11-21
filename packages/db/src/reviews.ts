import type { TransactionSql } from 'postgres';

export type ReviewFlagRow = {
  candidate: 'image' | 'link';
  kind: 'unhelpful_alt' | 'vague_link';
  selector: string;
  text: string;
  reason: string;
  suggestion: string;
  crop: string | null;
};

export function savePageReview(
  _tx: TransactionSql,
  _input: {
    orgId: string;
    runId: string;
    url: string;
    flags: ReviewFlagRow[];
    usage: { inputTokens: number; outputTokens: number; costMicros: number };
  },
): Promise<boolean> {
  return Promise.reject(new Error('not implemented'));
}
