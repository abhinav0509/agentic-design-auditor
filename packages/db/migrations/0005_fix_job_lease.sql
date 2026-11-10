-- A claimed fix job is leased until locked_until (v1.0 §9.2 job timeout, D-037).
alter table fix_jobs add column locked_until timestamptz;
