-- Agent review results (FR-29, D-046, D-048). A flag is what the review agent judged on one page:
-- the element as found, why, and a suggestion that is not tested on the site. Tenant data, isolated
-- like every tenant table (D-019). pages.reviewed_at marks a page whose review is saved, so flags
-- and the model cost (usage_ledger) are written once even when the scan step is retried.
alter table pages add column reviewed_at timestamptz;

create table review_flags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid not null,
  page_id uuid not null,
  candidate text not null check (candidate in ('image', 'link')),
  kind text not null check (kind in ('unhelpful_alt', 'vague_link')),
  selector text not null,
  current_text text not null,
  reason text not null,
  suggestion text not null,
  crop text,
  created_at timestamptz not null default now(),
  unique (page_id, selector, kind),
  unique (org_id, id),
  foreign key (org_id, run_id) references scan_runs(org_id, id),
  foreign key (org_id, page_id) references pages(org_id, id)
);

alter table review_flags enable row level security;
alter table review_flags force row level security;
create policy tenant_isolation on review_flags
  using (org_id = app_org_id()) with check (org_id = app_org_id());
grant select, insert on review_flags to beacon_app;
