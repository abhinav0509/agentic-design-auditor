# D-058: Undo a fix

- **Date:** 2026-11-22
- **Decision:** a reviewer can undo a fix that went into a pull request (FR-15), as addendum 1.5 describes.
  - **Before merge:** a revert commit on the fix's `beacon/*` branch drops it from the open PR.
  - **After merge:** a revert PR from the default branch undoes that one fix. Its branch is `beacon/<run>/<hash of "revert:<id>">`, and it is recorded as an `exports` row of kind `revert_pull_request`.
  - **Git port:** gains `updateBranch(name, sha, expected)`, fast-forward only and only from the expected head (GitHub: `PATCH git/refs` with `force: false`), and `pullRequestMerged(number)`. The exporter still refuses the default branch and anything not `beacon/<8 hex>/<12 hex>` (NFR-01, tested for undo too), so no branch ever moves backwards.
  - **Reverse change:** the fix's own diff turned around. It checks only the fix's own lines, not their context, because neighbouring fixes in the same PR change the context. A fix no longer there as made gives `no_longer_applies` and nothing is written, so a second undo is safe.
  - **Recording:** `undoFix` (worker) and `recordUndo` (db). The fix moves `applied` or `merged` → `reverted`, with the reviewer as the event's actor. A paused org undoes nothing (FR-28).
  - **Reviewer page:** "Undo this fix" on each fix that is in a pull request, with a notice after.
- **Context:** FR-15, addendum 1.5, D-040 (exporter), D-053 (export flow), M1.
- **Options:** (A) close the PR and re-export without the fix; (B) a revert commit or revert PR.
- **Chosen:** B. History stays honest and reviewable: every change, including undoing one, is a commit with a trailer (`Beacon-Revert: <id>`).
- **Consequences:**
  - **Merge state is read when undoing:** without the GitHub App's webhook, a fix stays `applied` after its PR merges. `pullRequestMerged` is read at undo time and the state machine allows `applied` → `reverted` either way. The `merged` status arrives with the webhook (M2).
  - **No guard re-run:** the revert restores what the repo had before Beacon's change, so the guard is not re-run on it.
