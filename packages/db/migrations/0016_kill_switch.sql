-- The org kill switch (FR-28, D-057): while set, no agent work runs for the org (fix jobs, previews,
-- the agent review, exports). People can still look and decide.
alter table organizations add column agent_paused_at timestamptz;
alter table organizations add column agent_paused_reason text;
