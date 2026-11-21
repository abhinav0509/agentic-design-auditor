import type { BlobStore, Clock } from '@beacon/core';
import type { Sql } from '@beacon/db';
import type { WebResponse } from './report-route.ts';
export type ReviewDeps = {
  sql: Sql;
  blobs: BlobStore;
  clock: Clock;
  operatorEmail: string;
  exportRun: (link: {
    orgId: string;
    runId: string;
  }) => Promise<{ status: string; pr?: { number: number; url: string } }>;
};
export function handleReviewRequest(
  _d: ReviewDeps,
  _r: { method: string; path: string; origin: string | null; host: string },
): Promise<WebResponse> {
  return Promise.reject(new Error('not implemented'));
}
