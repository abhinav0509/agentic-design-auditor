-- A page that could not be scanned is listed with its reason, a stable error code (v1.0 §12.3, D-038).
alter table pages add column scan_error text;
