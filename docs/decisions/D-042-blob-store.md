# D-042: Evidence in a blob store, by content address

- **Date:** 2026-11-15
- **Decision:** screenshot crops of flagged elements, for the URL-only report (FR-29, D-041), go to a `BlobStore`. Rows keep only a ref.
  - **Port:** `BlobStore { put(bytes, contentType) → ref; get(ref) → bytes | null }` in `@beacon/core`, injected like the other effects. `InMemoryBlobStore` lives in `@beacon/core/testing`. `FsBlobStore(root)` in `apps/worker` writes to the local disk (write, then rename).
  - **Refs:** `blob://sha256/<64 hex>.png`, from `blobRef(bytes, contentType)`. PNG is the only type allowed. `parseBlobRef` accepts exactly that shape, or throws `INVALID_BLOB_REF` (new error code), so a ref read back from the database can never name a path outside the store. Content addressing makes `put` idempotent, so a retried scan stores nothing twice.
  - **Crops:** `scanPageContent(context, url, { crops: true })` returns a PNG per distinct flagged target. An element is skipped when it is invisible, has no size, or is larger than the viewport (a crop of the whole page says nothing). At most 50 crops a page.
  - **Storage:** `scanRun` takes crops only when it is given `blobs`. It puts each crop before saving the page, then `savePageScan` writes `findings.evidence = { "crop": ref }`, after checking every ref. No migration: `evidence` already exists.
- **Context:** D-041 (report with screenshot crops); v1.0 §8.1 `evidence` (screenshots null until a BlobStore exists, D-032); conventions (inject BlobStore).
- **Options:** (A) bytes in Postgres (`bytea`); (B) a blob store with refs; and for keys, (1) path-like keys from run, page and finding, or (2) content hashes.
- **Chosen:** B2. Images stay out of the database and its backups. Hash keys make retries free and leave no user data in a path.
- **Consequences:**
  - **Object storage:** S3, R2 or Vercel Blob replaces `FsBlobStore` at deploy time behind the same port. Pick it with the region choice (addendum J.3).
  - **Retention (NFR-15):** deleting an org's data must also delete blobs no other row references. Blobs are shared by hash, so that needs a reference check or a sweep.
  - **Sensitive pixels:** a crop can show personal data that happens to be on a public page. Crops are served only through the report's own access checks and expiring links (FR-27), never from a public bucket.
  - **Re-scans:** a retried scan whose re-rendered pixels differ leaves the first crop on the row (inserts are `on conflict do nothing`). The new blob is an orphan until the sweep.
  - **Proposals:** `before_screenshot` and `after_screenshot` on proposals stay null. The verifier's screenshots can use this store next.
