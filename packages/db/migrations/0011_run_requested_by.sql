-- Who asked for a URL-only report run (D-041, D-045): the work email that proved the site (FR-30),
-- kept with the run as the abuse trail D-041 asks for. Null for runs started inside an org.
alter table scan_runs add column requested_by text;
