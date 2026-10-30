-- MVP schema: v1.0 §10.2 + addendum D.1, with tenant isolation per addendum 2.5 (D-019).
-- Tenant tables carry org_id; foreign keys between them include org_id, because RLS does not apply
-- to FK checks.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references organizations(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('owner', 'reviewer', 'viewer')),
  primary key (org_id, user_id)
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  base_url text not null,
  verified_at timestamptz,
  ownership_token text,
  ownership_verified_at timestamptz,
  autonomy_config jsonb not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

create table site_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  site_id uuid not null,
  provider text not null default 'github',
  installation_ref text not null, -- reference, not a raw token
  repo_full_name text not null,
  default_branch text not null,
  source_root text not null default '/',
  foreign key (org_id, site_id) references sites(org_id, id)
);

create table scan_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  site_id uuid not null,
  status text not null check (status in
    ('queued', 'scanning', 'fixing', 'verifying', 'ready', 'failed', 'canceled')),
  base_commit_sha text not null,
  agent_version text not null,
  prompt_version text not null,
  model_name text not null,
  engine_version text not null,
  budget jsonb not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, site_id) references sites(org_id, id)
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid not null,
  url text not null,
  screenshot_ref text,
  unique (run_id, url),
  unique (org_id, id),
  foreign key (org_id, run_id) references scan_runs(org_id, id)
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid not null,
  page_id uuid not null,
  fingerprint text not null,
  rule_id text not null,
  impact text not null,
  selector text not null,
  html_snippet text not null,
  mapped_file text,
  mapped_start_line int,
  mapped_end_line int,
  map_confidence real,
  evidence jsonb not null default '{}',
  unique (run_id, fingerprint, page_id),
  unique (org_id, id),
  foreign key (org_id, run_id) references scan_runs(org_id, id),
  foreign key (org_id, page_id) references pages(org_id, id)
);

create table proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid not null,
  finding_id uuid not null,
  attempt int not null default 1,
  supersedes_id uuid,
  version int not null default 1, -- optimistic concurrency
  kind text not null check (kind in ('patch', 'needs_input', 'decline')),
  -- Same set as STATUSES in @beacon/core; a contract test keeps them equal.
  status text not null check (status in
    ('pending', 'awaiting_input', 'approved', 'applied', 'closed_unmerged', 'merged', 'stale',
     'expired', 'apply_failed', 'rejected', 'declined', 'superseded', 'reverted', 'blocked',
     'failed_verification', 'answered')),
  schema_version text not null,
  payload jsonb not null, -- full Proposal JSON
  risk_level text check (risk_level in ('low', 'medium', 'high')),
  confidence real,
  base_commit_sha text not null,
  base_content_hash text not null,
  target_file_hash text not null, -- staleness key (addendum 1.2)
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Risk is required only for patches (Day 2 contract, D-015).
  check (kind <> 'patch' or risk_level is not null),
  unique (run_id, finding_id, attempt),
  unique (org_id, id),
  foreign key (org_id, run_id) references scan_runs(org_id, id),
  foreign key (org_id, finding_id) references findings(org_id, id),
  foreign key (org_id, supersedes_id) references proposals(org_id, id)
);

create table proposal_events ( -- append-only
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  proposal_id uuid not null,
  from_status text,
  to_status text not null,
  actor_type text not null check (actor_type in ('system', 'agent', 'user')),
  actor_id text,
  reason text,
  data jsonb not null default '{}',
  prev_hash bytea,
  hash bytea not null, -- hash chain (addendum 2.8)
  created_at timestamptz not null default now(),
  foreign key (org_id, proposal_id) references proposals(org_id, id)
);

create table decisions ( -- append-only
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  proposal_id uuid not null,
  user_id uuid not null,
  action text not null check (action in ('approve', 'reject', 'edit_approve', 'answer')),
  idempotency_key text not null,
  expected_version int not null,
  request_hash bytea not null,
  edited_diff text,
  reason text,
  decided_at timestamptz not null default now(),
  unique (proposal_id, idempotency_key),
  foreign key (org_id, proposal_id) references proposals(org_id, id),
  -- the decider must be a member of the proposal's org
  foreign key (org_id, user_id) references memberships(org_id, user_id)
);

create table exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  site_id uuid not null,
  kind text not null check (kind in ('pull_request', 'revert_pull_request')),
  branch text not null,
  pr_number int,
  pr_url text,
  proposal_ids uuid[] not null,
  status text not null check (status in ('pending', 'pushed', 'pr_open', 'failed')),
  created_at timestamptz not null default now(),
  unique (site_id, branch),
  foreign key (org_id, site_id) references sites(org_id, id)
);

create table llm_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id), -- not in addendum D.1; tenant data (D-019)
  run_id uuid,
  proposal_id uuid,
  step int,
  model_name text,
  prompt_version text,
  input_tokens int,
  output_tokens int,
  cached_tokens int,
  latency_ms int,
  cost_micros bigint,
  status text,
  request_ref text, -- redacted blobs, not raw columns
  response_ref text,
  created_at timestamptz not null default now(),
  foreign key (org_id, run_id) references scan_runs(org_id, id),
  foreign key (org_id, proposal_id) references proposals(org_id, id)
);

create table agent_traces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid not null,
  finding_id uuid not null,
  proposal_id uuid,
  step int not null,
  tool text not null,
  input_ref text,
  output_ref text,
  latency_ms int,
  error_code text,
  created_at timestamptz not null default now(),
  foreign key (org_id, run_id) references scan_runs(org_id, id),
  foreign key (org_id, finding_id) references findings(org_id, id),
  foreign key (org_id, proposal_id) references proposals(org_id, id)
);

create table usage_ledger ( -- append-only
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  run_id uuid,
  kind text not null check (kind in ('model', 'scan_page', 'verify')),
  units bigint not null,
  cost_micros bigint not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, run_id) references scan_runs(org_id, id)
);

create table outbox ( -- transactional outbox for GitHub side effects (addendum D.2)
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  topic text not null,
  payload jsonb not null,
  dedupe_key text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, dedupe_key) -- per org, so a conflict never reveals another org's key
);

create index on findings (run_id, rule_id);
create index on proposals (status, risk_level);
create index on proposal_events (proposal_id, created_at);

-- Append-only history: no update, delete or truncate, for any role including the owner.
create function reject_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'restrict_violation';
end $$;

do $$
declare t text;
begin
  foreach t in array array['proposal_events', 'decisions', 'usage_ledger'] loop
    execute format('create trigger %I before update or delete on %I for each row
                    execute function reject_mutation()', t || '_append_only', t);
    execute format('create trigger %I before truncate on %I for each statement
                    execute function reject_mutation()', t || '_no_truncate', t);
  end loop;
end $$;

-- Tenant isolation. An unset or reset app.org_id ('' after a transaction-local set) means no org,
-- so every policy matches nothing.
create function app_org_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

do $$
declare t text;
begin
  for t in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'org_id' loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I
                    using (org_id = app_org_id()) with check (org_id = app_org_id())', t);
  end loop;
end $$;

alter table organizations enable row level security;
alter table organizations force row level security;
create policy tenant_isolation on organizations
  using (id = app_org_id()) with check (id = app_org_id());

-- Users are visible through a membership in the current org. No write policy: creating users and
-- orgs belongs to sign-up (FR-01), which gets its own path.
alter table users enable row level security;
alter table users force row level security;
create policy member_of_current_org on users for select
  using (exists (select 1 from memberships m where m.user_id = users.id));

-- The app role: not an owner, no RLS bypass. Login roles are granted membership by deploy config.
do $$
begin
  if not exists (select from pg_roles where rolname = 'beacon_app') then
    create role beacon_app nologin nosuperuser nobypassrls;
  end if;
exception when duplicate_object or unique_violation then
  null; -- roles are cluster-wide; another database's migration created it concurrently
end $$;

grant usage on schema public to beacon_app;
grant select, insert, update, delete on all tables in schema public to beacon_app;
grant usage on all sequences in schema public to beacon_app;
revoke all on schema_migrations from beacon_app; -- created by the migrator before this file runs
revoke update, delete on proposal_events, decisions, usage_ledger from beacon_app;
