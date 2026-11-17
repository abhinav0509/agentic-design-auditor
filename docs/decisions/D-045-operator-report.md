# D-045: An operator script for URL-only reports

- **Date:** 2026-11-17
- **Decision:** until sign-in (FR-01) and a review UI exist, an operator makes reports for pilots with two scripts in `tools/report`.
  - **`pnpm report --requested-by <work email> <url> [url ...]`:**
    - `planReport` refuses the run unless the email's domain proves the site (FR-30, D-043), all URLs share one host, and there are at most 10.
    - `runReport` creates the prospect's org (one per host, with an id derived from the host, so re-runs reuse it), its site and a run, all as `beacon_app` under RLS. Then it runs the normal scan step with crops, marks the run `ready` and creates a 14-day link.
    - The script runs Chromium through a real Smokescreen (default policy: public addresses only) plus the in-app guard with the system resolver: the same layers as the worker (D-017, D-020). Crops go to `FsBlobStore` (`BEACON_BLOB_DIR`, default `.data/blobs`). It prints `BEACON_PUBLIC_URL` + `/r/<token>`.
  - **`pnpm report:serve`:** a `node:http` server, GET and HEAD only, bound to `127.0.0.1:4180` unless `HOST`/`PORT` say otherwise. It mounts `handleReportRequest` (D-044). Errors are logged; the response says only "Something went wrong."
  - **Migration `0011`:** `scan_runs.requested_by` keeps the email that proved the site, as the abuse trail D-041 asks for.
- **Context:** D-041 (report before repo access), D-043 (email rule), D-044 (route); FR-01 not built.
- **Options:** (A) wait for sign-in and a UI; (B) an operator script on the existing pieces.
- **Chosen:** B. Pilots can get a report now, and the code reuses the scan step, blob store, links and route unchanged.
- **Consequences:**
  - **Attested, not verified:** the operator vouches that the request came from that address. Nothing is sent to it. Real verification comes with sign-in (an email link). Until then, the operator only runs reports for requests they received from that address.
  - **Sharing:** links point at the operator's machine. To share outside, put `report:serve` behind HTTPS (a tunnel or a host) and set `BEACON_PUBLIC_URL`. The token is a bearer secret: 32 random bytes, stored only as a hash.
  - **Report runs:** a report run has no repo, so `base_commit_sha`, `agent_version`, `prompt_version` and `model_name` are `'none'`. The engine version is real.
  - **Smoke test (2026-11-17):** example.com through the real proxy flagged 9 elements, all best practice. The page, crops and headers were served, an unknown token got 404, and POST got 405.
