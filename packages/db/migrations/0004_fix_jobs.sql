-- The fix-job queue (D-037): one job per mapped finding in a run, keyed by (run_id, fingerprint)
-- (v1.0 §9.1 step 6). Tenant data, isolated like every other tenant table (D-019).
create table fix_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid not null,
  fingerprint text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  unique (run_id, fingerprint),
  unique (org_id, id),
  foreign key (org_id, run_id) references scan_runs(org_id, id)
);

alter table fix_jobs enable row level security;
alter table fix_jobs force row level security;
create policy tenant_isolation on fix_jobs
  using (org_id = app_org_id()) with check (org_id = app_org_id());
grant select, insert, update, delete on fix_jobs to beacon_app;
