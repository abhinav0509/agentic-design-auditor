# D-051: Reviewer decisions in Postgres, and the operator approver

- **Date:** 2026-11-21
- **Decision:** `decideProposal(tx, { orgId, proposalId, userId, input, at })` in `@beacon/db` makes core's pure `decide()` (FR-13: idempotency key with request hash, version, expiry, state machine) durable.
  - **Steps:**
    1. Load the proposal (`NOT_FOUND`, a new error code, when it is not visible under RLS) and its earlier decisions.
    2. Run `decide()`. A replay returns without writing.
    3. Otherwise, `update proposals … where version = expectedVersion`. If nothing moved, a concurrent decision won and the result is `VERSION_CONFLICT`.
    4. Write the decision row and its audit event. The database hash-chains the event (D-036).
  - **The race is tested against Postgres:** two approvals with different keys at the same version, run at once. Exactly one wins, which closes that Phase 1 todo.
  - **Operator approver:** `ensureOperator(sql, { orgId, email })` runs through the migration connection, since the app role may not create users before sign-up. It creates one user per email and makes it a `reviewer` of the org, idempotently. `decisions` already requires the approver to be a member of the proposal's org.
- **Context:** FR-11, FR-13, FR-16; the demo flow (fix → verify → approve → PR); FR-01 (sign-in) is not built. The owner chose the operator user over building sign-in first (2026-11-21).
- **Options:** (A) an operator user per org; (B) sign-in first.
- **Chosen:** A. The audit trail records a real user id now, and sign-in later replaces how that user is created, not how decisions are stored.
- **Consequences:**
  - **Same person in every org:** every operator approval is the operator's email until sign-in. The CLI uses the operator's own email.
  - **Not implemented yet:** `answer` (needs_input) and `edit_approve` (FR-24) decisions are in core but not written here; they come with the review UI.
