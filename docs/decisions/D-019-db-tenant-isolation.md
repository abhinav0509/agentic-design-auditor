# D-019: Database access, migrations and tenant isolation

- **Date:** 2026-10-30
- **Decision:**
  - Driver: `postgres` (postgres.js, pinned). Schema lives in hand-written, forward-only SQL migrations in `packages/db/migrations`, applied by `migrate()` in one transaction under an advisory lock. Drizzle table definitions (CLAUDE.md) are added with the first query code, generated from or checked against this SQL; RLS, triggers and roles stay in SQL.
  - Every tenant table carries `org_id` under `enable` + `force` RLS with one policy: `org_id = app_org_id()`. `app_org_id()` reads `app.org_id` and treats unset or `''` (left behind by a transaction-local set on a pooled connection) as no org, so queries fail closed.
  - Foreign keys between tenant tables are composite `(org_id, id)`. RLS does not apply to FK checks, so a single-column FK would let org A attach rows to org B's parents by id.
  - `beacon_app`: no login, not superuser, no BYPASSRLS, owns nothing, no access to `schema_migrations`, no UPDATE/DELETE on history tables. Deploy config grants it to the login role.
  - `proposal_events`, `decisions`, `usage_ledger`: triggers reject update, delete and truncate for every role.
  - Tests: one throwaway database per test file, from `BEACON_TEST_DATABASE_URL` (default `postgres://localhost/postgres`). Local Homebrew Postgres 17; CI uses a digest-pinned `postgres:17.11` service.
- **Deviations from the spec, to fix in the docs:**
  - `llm_calls.org_id` added (addendum D.1 left it out; it is tenant data).
  - `outbox.dedupe_key` is unique per org, not globally, so a conflict never reveals another org's key.
  - `proposals.risk_level` is nullable, required only for `kind = 'patch'` (Day 2 contract in D-015; v1.0 §10.2 says `not null`).
  - `decisions (org_id, user_id)` references `memberships`: only a member of the org can decide.
  - `organizations` and `users` are readable (own org; members of own org) but not writable by `beacon_app`. Sign-up (FR-01) gets its own path.
- **Options considered:** PGlite (no setup, but one connection, so no concurrency tests); testcontainers (needs Docker); Drizzle-generated migrations (cannot express RLS, triggers and roles without custom SQL anyway).
- **Revisit:** when the API needs sign-up writes (FR-01), and when Drizzle table definitions arrive.
