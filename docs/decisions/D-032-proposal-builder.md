# D-032: The proposal builder

- **Date:** 2026-11-01
- **Decision:** `buildProposal(input, { clock, ids })` in `@beacon/core` turns a fixer answer (patch, question or decline) and, for a patch, the verifier's outcome into a v1.0 §8.1 proposal, validated by `ProposalSchema` (fail closed), plus its initial status.
  - **Status:** `pending` only when verification passed; `failed_verification` when it failed for any reason, including the visual hard cap; `awaiting_input` and `declined` for questions and declines (`initialStatus`).
  - **Risk:** recomputed by the classifier with the verifier's `visualDiffRatio`, so a visible change raises risk to high; `reversible` is always true for attribute edits.
  - **Change:** a one-hunk unified diff (3 lines of context, `\ No newline at end of file` handled), checked in tests by `git apply` reproducing the patched file exactly. No diff dependency.
  - **Fields:** WCAG references per rule (image-alt 1.1.1; label 1.3.1, 4.1.2; html-has-lang 3.1.1), references only, never a compliance claim; `expires_at` is 7 days after creation (§8.1 example); `target.range` is the changed line range.
  - **Ports:** `Clock` and `IdGen` types in core (conventions); this is their first use.
- **Context:** FR-08 (guard and verifier before ready); v1.0 §7.2 data flow.
- **Options:** builder in the agent package, in the worker, or in core.
- **Chosen:** core, as a pure function with structural input types, since core cannot import agent or verifier (both depend on it). The worker's fix job will call fixer → verifier → builder.
- **Consequences:** guard-blocked and failed fixer runs and `UNMAPPED_LOCAL_MISMATCH` findings are not proposals; they stay in the trace or report. Screenshots are null until a BlobStore exists. One hunk only: lines between two edits show as removed and re-added.
