// Blob refs (FR-29, D-042): evidence such as screenshot crops lives in a BlobStore, and rows keep
// only a ref. A ref is content-addressed, so a retried scan stores nothing twice, and its strict
// shape means a ref read back from the database can never name a path outside the store.
import { createHash } from 'node:crypto';
import { DomainError } from './errors.ts';

const EXTENSIONS: Record<string, string> = { 'image/png': 'png' };
const REF = /^blob:\/\/(sha256\/[0-9a-f]{64}\.png)$/;

export function blobRef(bytes: Uint8Array, contentType: string): string {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw new DomainError('INVALID_BLOB_REF', `unsupported content type ${contentType}`);
  return `blob://sha256/${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
}

/** The store key of a ref (`sha256/<hex>.png`). Throws INVALID_BLOB_REF for anything else. */
export function parseBlobRef(ref: string): string {
  const key = REF.exec(ref)?.[1];
  if (key === undefined) throw new DomainError('INVALID_BLOB_REF', 'not a blob ref');
  return key;
}
