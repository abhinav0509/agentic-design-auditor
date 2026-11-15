// Injected effects (conventions): domain code never reads the time or makes ids by itself.
export type Clock = { now(): Date };
export type IdGen = { uuid(): string };

/** Where evidence bytes live (screenshot crops). Refs come from `blobRef`; `put` is idempotent. */
export type BlobStore = {
  put(bytes: Uint8Array, contentType: string): Promise<string>;
  get(ref: string): Promise<Uint8Array | null>;
};
