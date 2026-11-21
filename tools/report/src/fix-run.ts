import type { Clock, GitProvider } from '@beacon/core';
import type { Sql } from '@beacon/db';
import type { SiteFiles } from '@beacon/verifier';
import type { Browser } from 'playwright';
export function approveFixes(
  _d: { sql: Sql; clock: Clock },
  _i: { token: string; operatorEmail: string; which: 'all' | number[] },
): Promise<{ n: number; title: string; status: string }[]> {
  return Promise.reject(new Error('not implemented'));
}
export function exportFixes(
  _d: {
    sql: Sql;
    browser: Browser;
    git: GitProvider;
    checkout: (sha: string) => Promise<SiteFiles>;
    clock: Clock;
  },
  _token: string,
): Promise<unknown> {
  return Promise.reject(new Error('not implemented'));
}
