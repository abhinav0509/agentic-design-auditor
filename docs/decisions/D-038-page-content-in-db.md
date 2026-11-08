# D-038: A scanned page's HTML and text live on `pages`

- **Date:** 2026-11-08
- **Decision:** migration `0006` adds `pages.served_html` and `pages.visible_text`. `savePageScan(tx, { orgId, runId, url, served, text, findings })` stores the page, each finding with its core `fingerprint` (one row per page, unique on `(run_id, fingerprint, page_id)`), and enqueues one fix job per fingerprint (D-037). Every insert is `on conflict do nothing`, so a retried scan step adds nothing; the same fingerprint on another page shares its job.
- **Scanner:** `scanPageContent(context, url)` returns `{ served, text, findings }` from one guarded page load: `served` is the main document's response body (not the rendered DOM), `text` is `document.body.innerText` after render. `scanPage` returns its `findings`, so its callers are unchanged.
- **Context:** the fix job needs the page as served (the mapper compares it with the repo file, D-007) and its visible text (the fixer's untrusted page content). A crashed run must resume from the database without scanning again (NFR-03). v1.0 §9.1 steps 1-4 and 6, FR-05.
- **Options:** (1) columns on `pages`; (2) a `BlobStore` port and fake, with references on `pages`; (3) keep them in memory and scan and fix in one process.
- **Chosen:** (1), approved by the owner on 2026-11-08. Option 3 does not meet NFR-03; option 2 is more work before anything runs, for 10 static pages per run.
- **Consequences:** page HTML is customer content in Postgres, under the same RLS as everything else (D-019), and is covered by the retention and deletion work (NFR-15). Move it to a blob store when pages grow (templates, crawling in Phase 2) or when screenshots arrive with a `BlobStore`.
