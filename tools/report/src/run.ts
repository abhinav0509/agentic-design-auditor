import type { BlobStore, Clock } from '@beacon/core';
import type { Sql } from '@beacon/db';
import type { BrowserContext } from 'playwright';
import type { ReportPlan } from './plan.ts';

export type RunReportDeps = {
  sql: Sql;
  context: BrowserContext;
  blobs: BlobStore;
  clock: Clock;
  token: () => string;
};

export function runReport(
  _deps: RunReportDeps,
  _plan: ReportPlan,
): Promise<{ path: string; expiresAt: Date }> {
  return Promise.reject(new Error('not implemented'));
}
