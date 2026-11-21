import type { LlmClient } from '@beacon/agent';
import type { BlobStore, Clock, IdGen } from '@beacon/core';
import type { Sql } from '@beacon/db';
import type { Browser } from 'playwright';
export function previewFixes(
  _d: { sql: Sql; browser: Browser; llm: LlmClient; clock: Clock; ids: IdGen; blobs: BlobStore },
  _i: { orgId: string; runId: string },
): Promise<void> {
  return Promise.reject(new Error('not implemented'));
}
