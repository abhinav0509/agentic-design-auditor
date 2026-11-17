// A BlobStore on the local disk (D-042), for development and single-machine pilots. Object storage
// replaces it at deploy time behind the same port.
import { blobRef, parseBlobRef, type BlobStore } from '@beacon/core';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class FsBlobStore implements BlobStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async put(bytes: Uint8Array, contentType: string): Promise<string> {
    const ref = blobRef(bytes, contentType);
    const path = join(this.root, parseBlobRef(ref));
    await mkdir(dirname(path), { recursive: true });
    // Write then rename, so a crash never leaves a half-written blob under its final name.
    const tmp = `${path}.${randomUUID()}.tmp`; // unique: two puts of one crop can race
    await writeFile(tmp, bytes);
    await rename(tmp, path);
    return ref;
  }

  async get(ref: string): Promise<Uint8Array | null> {
    const path = join(this.root, parseBlobRef(ref));
    try {
      return new Uint8Array(await readFile(path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
}
