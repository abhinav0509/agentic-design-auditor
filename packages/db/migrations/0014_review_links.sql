-- Reviewer links (FR-11, D-055): a report link that may also approve, reject and export. It is a
-- separate random token from the share link, so sharing a report never shares the right to act.
alter table report_links add column can_review boolean not null default false;
