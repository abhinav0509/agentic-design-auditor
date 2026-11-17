// Test builders (D-015). Not imported by production code.
import example from './__fixtures__/proposal.example.json' with { type: 'json' };
import { blobRef, parseBlobRef } from './blob.ts';
import type { BlobStore } from './ports.ts';
import { parseProposal, type Proposal } from './proposal.ts';

/** Runs fn and returns what it threw (undefined if nothing), for asserting on error codes. */
export function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

/** A valid patch proposal (the §8.1 example) with top-level fields overridden; still schema-checked. */
export const makeProposal = (overrides: Record<string, unknown> = {}): Proposal =>
  parseProposal({ ...structuredClone(example), ...overrides });

/** A BlobStore in memory, keyed like the real ones. */
export class InMemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Uint8Array>();

  put(bytes: Uint8Array, contentType: string): Promise<string> {
    const ref = blobRef(bytes, contentType);
    this.blobs.set(parseBlobRef(ref), bytes);
    return Promise.resolve(ref);
  }

  get(ref: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.blobs.get(parseBlobRef(ref)) ?? null);
  }
}
