-- Fix previews (FR-29, D-056): the fix Beacon would make for a finding, produced and verified on a
-- copy of the live page, for the URL-only report. They are not proposals: nothing here is approved
-- or exported. With repo access, a real run makes proposals against the source instead.
create table fix_previews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid not null,
  finding_id uuid not null,
  rule_id text not null,
  title text not null,
  rationale text not null,
  before_html text not null,
  after_html text not null,
  announced_before text,
  announced_after text,
  verified boolean not null,
  crop text,
  created_at timestamptz not null default now(),
  unique (finding_id),
  unique (org_id, id),
  foreign key (org_id, run_id) references scan_runs(org_id, id),
  foreign key (org_id, finding_id) references findings(org_id, id)
);

alter table fix_previews enable row level security;
alter table fix_previews force row level security;
create policy tenant_isolation on fix_previews
  using (org_id = app_org_id()) with check (org_id = app_org_id());
grant select, insert on fix_previews to beacon_app;
