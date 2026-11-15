import type { BlobStore, Clock } from '@beacon/core';
import type { Sql } from '@beacon/db';

export type WebResponse = {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
};

export function handleReportRequest(
  _deps: { sql: Sql; blobs: BlobStore; clock: Clock },
  _path: string,
): Promise<WebResponse> {
  return Promise.reject(new Error('not implemented'));
}
