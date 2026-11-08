# D-034: The fix job

- **Date:** 2026-11-02
- **Decision:** `runFixJob(deps, { runId, site, page, finding })` in `apps/worker` runs one scan finding through mapper → bounded fixer → verifier → proposal builder. It returns `unmapped` (the mapper's reason, or `UNMAPPED_LOCAL_MISMATCH` from the verifier), `no_proposal` (the fixer was blocked or failed; its result and trace are kept), or `proposal` with its status.
  - **Tools:** `siteTools(files, finding)` serves the fixer read-only from the checkout in memory: files whole or by line range, a search over text files (`path:line: text`, top 20), the engine's snippet, and the image its `src` resolves to. Binary or unknown files are errors; an image that is missing or not JPEG, PNG, GIF or WebP fails as "the image could not be loaded", which the prompt treats as a reason to ask.
  - **Risk context:** `insideForm` is computed from the source (a `<form>` ancestor of the mapped element). `decorativeAgreed` stays false until the Review Kit records that agreement.
  - **Test helpers:** `@beacon/agent/testing` exposes the agent's FakeLlm and builders to the worker's tests (the D-015 revisit). A subpath export, not a testkit package yet: one consumer, no cycle to break.
- **Context:** FR-06, FR-07, FR-08, FR-09; v1.0 §7.5 (worker), §9.1 steps 5-6, §9.2, §9.4.
- **Options:** check that the finding reproduces locally before the fixer runs, or let the verifier do it after.
- **Chosen:** after, in the one `verify` call that already reproduces, patches and diffs. No extra render per finding.
- **Consequences:** a finding that does not reproduce locally still costs one fixer run; move the check first if cost reports show it. The job is a function, not yet a queue consumer: the Postgres queue, idempotency keyed by (run_id, fingerprint), retries and the 120 s job timeout come with the DB-backed runner.
