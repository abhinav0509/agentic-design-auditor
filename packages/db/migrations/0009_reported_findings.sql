-- Violations outside the fixable rules, kept for the URL-only report (FR-29, D-041). They share the
-- findings table and its per-page dedupe, but get no fix job; help and tags are axe's own text and
-- WCAG tags, shown as references, never as a compliance claim.
alter table findings add column actionable boolean not null default true;
alter table findings add column help text;
alter table findings add column tags text[] not null default '{}';
