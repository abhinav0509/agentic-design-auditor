# D-053: Exporting a run's approved fixes

- **Date:** 2026-11-21
- **Decision:** `exportRun({ sql, browser, git, checkout, clock }, { orgId, runId })` (`apps/worker`) ties approval to a PR:
  1. **Load:** `loadApproved` reads the run's approved proposals with the engine rule of each finding, in id order. None means `nothing_to_export`, and GitHub is not touched.
  2. **Export:** the exporter (D-040) runs with a combined verification (FR-25). The checkout of the live default branch head, plus the batch's changed files, is the "after". Every approved finding must re-verify as passed: its violation is gone and nothing new appears.
  3. **Record:** `recordExport` writes the outcome through the state machine with system events.
     - A PR: the proposals move to `applied` and an `exports` row records branch, PR number and URL.
     - A patch that no longer applies: those proposals move to `apply_failed`.
     - A guard block or a failed verification: nothing moves, and the result says why.
     - A retried write finds nothing left to move, and the exports row is unique per site and branch.
- **Context:** FR-14, FR-25, D-040 (exporter), D-051 (decisions), D-052 (GitHub adapter), the demo flow.
- **Options:** (A) the transactional outbox (addendum D.2) now; (B) a direct call with idempotent writes.
- **Chosen:** B for the demo. The exporter is already crash-safe on its own (D-040: the branch is created last, so a retry only opens the PR), and recording is idempotent. A crash between PR and record leaves an open PR with approved proposals, and re-running `exportRun` records it.
- **Consequences:**
  - **Outbox still owed:** the outbox and its worker are required before more than one worker exports (addendum D.2, NFR-03).
  - **Kill switch:** FR-28 is not checked here yet; it comes with org settings.
  - **Verification cost:** each export re-renders every approved page twice (before and after) on the combined change. That is fine for a demo batch and should be watched for large ones.
