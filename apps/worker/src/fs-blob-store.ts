import type { BlobStore } from '@beacon/core';

export class FsBlobStore implements BlobStore {
  constructor(readonly root: string) {}
  put(_bytes: Uint8Array, _contentType: string): Promise<string> {
    return Promise.reject(new Error('not implemented'));
  }
  get(_ref: string): Promise<Uint8Array | null> {
    return Promise.reject(new Error('not implemented'));
  }
}
