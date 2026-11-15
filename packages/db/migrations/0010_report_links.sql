-- Share links for the URL-only report (FR-27, D-044). A link names one run, expires and can be
-- revoked. Only sha256(token) is stored, so a database leak does not leak working links.
create table report_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid not null,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, run_id) references scan_runs(org_id, id)
);

alter table report_links enable row level security;
alter table report_links force row level security;
create policy tenant_isolation on report_links
  using (org_id = app_org_id()) with check (org_id = app_org_id());

-- A viewer has no org: the request sets app.report_token_hash, and this read-only policy shows the
-- one link with that hash. Everything else the report reads runs as that link's org.
create function app_report_token_hash() returns bytea language sql stable as $$
  select decode(nullif(current_setting('app.report_token_hash', true), ''), 'hex')
$$;
create policy by_token on report_links for select using (token_hash = app_report_token_hash());

grant select, insert, update on report_links to beacon_app;
