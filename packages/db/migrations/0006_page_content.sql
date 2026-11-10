-- A scanned page as served and its visible text (D-038), so the fix jobs of a crashed run resume
-- from the database without scanning again (NFR-03). The mapper compares the served HTML with the
-- repo file; the fixer reads the text as untrusted page content.
alter table pages add column served_html text;
alter table pages add column visible_text text;
