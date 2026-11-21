import type { Clock, GitProvider } from '@beacon/core';
import type { Sql } from '@beacon/db';
import type { ExportResult } from '@beacon/exporter';
import type { SiteFiles } from '@beacon/verifier';
import type { Browser } from 'playwright';
export function exportRun(
  _d: {
    sql: Sql;
    browser: Browser;
    git: GitProvider;
    checkout: (sha: string) => Promise<SiteFiles>;
    clock: Clock;
  },
  _i: { orgId: string; runId: string },
): Promise<ExportResult | { status: 'nothing_to_export' }> {
  return Promise.reject(new Error('not implemented'));
}
