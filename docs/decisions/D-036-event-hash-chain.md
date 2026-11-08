# D-036: The audit hash chain is computed by a trigger

- **Date:** 2026-11-08
- **Decision:** a `before insert` trigger on `proposal_events` (migration `0002`) chains every event per org (addendum 2.8):
  - It takes a transaction-scoped advisory lock on the org (`pg_advisory_xact_lock(1, hashtext(org_id))`), so two writers in one org never link to the same previous event.
  - It takes a new `id` after the lock, because the identity default runs before the trigger. Id order is then chain order, even when a writer waited.
  - `prev_hash` is the org's latest event's `hash` (null for the first). `hash = sha256(coalesce(prev_hash, '') || utf8(jsonb_build_object(id, org_id, proposal_id, from_status, to_status, actor_type, actor_id, reason, data, created_at at time zone 'UTC')::text))`. Writers' hashes are overwritten.
- **Context:** FR-16, NFR-10, addendum 2.8. `audit-chain.test.ts` holds the formula as the verifier contract.
- **Options:** compute the hash in app code (each writer must remember to; app clocks and JSON order to agree on); a trigger (every writer chained, one place).
- **Chosen:** the trigger, approved by the owner on 2026-11-08.
- **Consequences:** an export verifier recomputes hashes from Postgres's `jsonb` text form, not JavaScript's `JSON.stringify`; it can run the same SQL expression or reproduce the `jsonb` key order (shorter keys first, then bytewise). Writes to `proposal_events` are serialised per org, which is fine at MVP volume. `created_at` is still whatever the writer supplies (default `now()`); forcing the database time is a separate change with its own test.
