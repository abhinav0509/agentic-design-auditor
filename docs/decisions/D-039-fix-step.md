# D-039: The fix step of a run

- **Date:** 2026-11-08
- **Decision:** `runFixJobs({ sql, browser, llm, clock, ids }, { orgId, runId, site })` in `apps/worker` loops until `claimFixJob` returns null:
  - `loadFixJob` returns the job's finding (first page in URL order when the fingerprint is on several) and that page as stored (D-038).
  - `runFixJob` (D-034) runs outside any transaction. Saving the proposal and finishing the job share one transaction, so a crash between them is a retry, and the retry's save is a no-op (D-035).
  - Outcomes: a model error (`failed` / `LLM_ERROR`) or a thrown error finishes the job as `error` (one retry, then `failed`; D-037). Every other result is `done`: a proposal of any status, unmapped, guard-blocked, or a fixer that ran out of steps or budget.
  - When no job is free, the run becomes `ready`.
  - Migration `0008` adds `findings.engine_rule`, stored by `savePageScan`: the verifier finds the violation again by the engine's rule id (for example `select-name` under Beacon's `label`).
- **Context:** v1.0 §9.1 step 6, §9.2; FR-07, FR-08, NFR-03; D-034 consequences.
- **Options:** one transaction around the whole job (holds a connection and row locks for a model run of up to 120 s); claim, run and finish in separate transactions with idempotent writes.
- **Chosen:** separate transactions with idempotent writes.
- **Consequences:**
  - The checkout (`site.files`, `commitSha`) is passed in; a `GitProvider` port supplies it when the GitHub App lands.
  - One worker per run: `ready` is set when this worker finds no free job, even if a job is still leased elsewhere. Count open jobs before setting `ready` when runs get several workers.
  - An unmapped finding or a fixer with no answer is a `done` job with no proposal; the reason is not stored yet, so the report (FR-17) and the run trace (NFR-08) need it on the finding or the job. A thrown error's message is not recorded either (`shortcut:` in the code).
