-- The engine's own rule id (for example select-name under Beacon's label rule): the verifier needs it
-- to find the same violation again (D-031, D-039).
alter table findings add column engine_rule text;
