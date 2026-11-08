# D-035: Plain SQL for the first queries; proposals saved once per finding

- **Date:** 2026-11-08
- **Decision:**
  - Query code in `packages/db` uses tagged SQL through the existing `postgres` driver. No Drizzle yet. This overrides the D-019 note that Drizzle table definitions arrive with the first query code.
  - `saveProposal(tx, { orgId, findingId, proposal, status })` inserts the proposal as attempt 1 with `on conflict (run_id, finding_id, attempt) do nothing`, plus its first `proposal_events` row in the same transaction. A retried job gets the stored proposal's id back with `created: false` and writes nothing (NFR-03). The proposal row's id is the payload's `proposal_id`, so the two never disagree.
  - The caller supplies a transaction that already runs as the app role with `app.org_id` set, so RLS applies to every query.
- **Context:** first slice of the DB-backed runner (D-034 consequences); v1.0 §9.1 step 6, NFR-03.
- **Options:** Drizzle now (a new dependency and a second copy of a schema whose RLS, triggers and roles stay in SQL anyway, for one insert); plain SQL now, Drizzle later.
- **Chosen:** plain SQL, approved by the owner on 2026-11-08.
- **Consequences:** query results are typed by hand (`tx<{ id: string }[]>`), so a renamed column fails in tests, not in `tsc`. Revisit when the API (v1.0 §11) brings enough read queries that typed table definitions pay for themselves. Until the per-org hash chain lands (addendum 2.8), an event's `hash` covers its own row only and `prev_hash` is null.
