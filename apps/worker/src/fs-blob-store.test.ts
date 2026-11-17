import { blobRef, DomainError } from '@beacon/core';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { FsBlobStore } from './fs-blob-store.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7]);
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'beacon-blobs-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it('FR-29: stores a crop under its content address and reads it back, once', async () => {
  const store = new FsBlobStore(root);

  const ref = await store.put(PNG, 'image/png');
  const again = await store.put(PNG, 'image/png');

  expect(ref).toBe(blobRef(PNG, 'image/png'));
  expect(again).toBe(ref);
  expect(await store.get(ref)).toEqual(PNG);
  expect(readdirSync(join(root, 'sha256'))).toHaveLength(1);
});

it('FR-29: a ref that was never stored reads as null', async () => {
  expect(await new FsBlobStore(root).get(blobRef(new Uint8Array([1]), 'image/png'))).toBeNull();
});

it('FR-29: refuses a ref that would read outside the store', async () => {
  const error: unknown = await new FsBlobStore(root)
    .get('blob://sha256/../../etc/passwd')
    .catch((e: unknown) => e);

  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe('INVALID_BLOB_REF');
});
