# D-040: The exporter

- **Date:** 2026-11-15
- **Decision:** `exportBatch({ git, verify }, { runId, proposals })` in `@beacon/exporter` turns approved patch proposals into one branch and one PR (FR-14, FR-25, NFR-01; addendum 1.5, 2.6, D.2).
  - **Port:** `GitProvider` in `@beacon/core` (one repository): live `defaultBranch()`, `headSha`, `readFile`, `createCommit` (one file, no ref moves), `createBranch` (fails if it exists), `findPullRequest`, `openPullRequest`. `FakeGitProvider` is exported from `@beacon/exporter/testing`.
  - **Branch:** `beacon/<first 8 of run id>/<first 12 hex of sha256 of the sorted proposal ids>`. Before any write, the exporter looks up the default branch live and refuses (`BRANCH_NOT_ALLOWED`, new error code) when the name is not exactly `beacon/<8 hex>/<12 hex>` or equals the default branch.
  - **Apply:** proposals sorted by id. Each one-hunk diff is checked against the file at the default branch's head (context and removed lines must match where the hunk says, with no fuzz). Only its changed lines are spliced in, shifted by earlier changes above them, so neighbours' context never conflicts. A mismatch, a missing file or two changes touching the same line make those proposals `apply_failed`.
  - **Checks:** the guard re-runs on every step on top of the earlier ones, so the combined file is guarded (for example, a duplicate `id` across two proposals is `blocked`). Then `verify` (injected) runs once on the combined files.
  - **Push:** one commit per proposal with a `Beacon-Proposal: <id>` trailer. The branch is created last, pointing at the finished commits, then the PR is opened if none exists for the branch.
  - **All or nothing:** any `apply_failed`, `blocked` or `verification_failed` result pushes nothing. The caller marks those proposals and re-exports the rest as a new batch (new branch name).
- **Context:** v1.0 §7.3, §11 (`POST /api/exports`, idempotent by branch name); addendum 1.5 (FR-25), 2.6 (live default-branch check), D.2 (deterministic branch name).
- **Options:** (A) create the branch first and push commits onto it; (B) build unreferenced commits, then create the branch at the last one. And (1) drop failing proposals and export the rest; (2) fail the whole batch.
- **Chosen:** B and 2. With B, a branch exists only when complete, so a retry after a crash at any write (tested) either rebuilds harmless unreferenced commits or just opens the PR. With 2, a branch always holds exactly its batch, so a retry never has to work out which proposals it contains.
- **Consequences:**
  - Not wired yet: the outbox row and `exports` table writes, proposal transitions (`applied`, `apply_failed`), the real `verify` (the worker runs the verifier for each proposal's finding on the combined files), the GitHub App adapter, and the kill switch (FR-28).
  - A retry after the default branch moved re-plans against the new head, but if the branch already exists it is reused as built.
  - Context mismatch is strict: an unrelated edit within 3 lines of a proposal makes it `apply_failed` (as `git apply` without fuzz would). Re-propose (Phase 2) covers it.
  - Undo (FR-15) is next: a revert commit on the branch before merge, a revert PR after.
