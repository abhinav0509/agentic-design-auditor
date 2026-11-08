# D-037: A small fix-job queue in Postgres, not pg-boss (yet)

- **Date:** 2026-11-08
- **Decision:** fix jobs live in a `fix_jobs` table (migration `0004`), one row per mapped finding in a run, unique on `(run_id, fingerprint)` (v1.0 §9.1 step 6). `enqueueFixJob(tx, { orgId, runId, fingerprint })` inserts with `on conflict do nothing` and returns the existing job on a repeat (NFR-03). `claimFixJob(tx, { runId })` takes the oldest queued job of the run with `for update skip locked`, marks it `running`, counts the attempt and leases it until the database time + 120 s (`locked_until`, migration `0005`; the v1.0 §9.2 job timeout). Reclaiming an expired lease, one retry and `failed` arrive one test at a time on this table.
  - `fix_jobs` is tenant data: `org_id`, composite foreign keys, forced RLS and the `tenant_isolation` policy, like every table in D-019. `seedOrg` seeds it, so the RLS matrix covers it.
- **Context:** D-034 consequences; v1.0 §7.4 and addendum C name pg-boss.
- **Options:** pg-boss (a dependency with its own schema and tables outside our RLS, and a cross-tenant job table); a table of our own.
- **Chosen:** our own table, approved by the owner on 2026-11-08. The runner needs per-finding idempotency, a lease and one retry: a few queries, all under RLS.
- **Consequences:** under RLS a worker sees only the org it has set, so it claims jobs run by run for an org it already knows. A dispatcher that picks the next run across orgs needs its own narrow role (for example a `security definer` function that returns only org and run ids); decide that when the worker becomes a long-running service. Move to pg-boss if we need scheduling, cron or fan-out that this table cannot carry.
