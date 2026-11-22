# D-057: The org kill switch

- **Date:** 2026-11-22
- **Decision:** `organizations.agent_paused_at` and `agent_paused_reason` (migration `0016`). `setAgentPaused(tx, { paused, at, reason })` and `agentPaused(tx)` act on the current org only, under RLS.
  - **While paused, nothing an agent does runs (FR-28):**
    - `runFixJobs` and `previewFixes` claim nothing; queued jobs wait for the org to resume
    - `scanRun` still scans but skips the agent review
    - `exportRun` returns `{ status: 'paused' }` without touching GitHub
  - **Checked before each job claim:** pausing mid-run stops at the next job. A model call already under way finishes and is recorded, never cut off half-written.
  - **People can still act:** they can look, approve and reject, because pausing is about agents, not reviewers. The reviewer page says when an export was refused for a pause.
  - **Operator:** `pnpm fix pause <report link> [reason]` and `pnpm fix resume <report link>`.
- **Context:** FR-28, the M1 milestone (`docs/roadmap.md`).
- **Options:** (A) a flag checked at each agent entry point; (B) cancelling queued work.
- **Chosen:** A. Nothing is lost, resuming picks up where it stopped, and the check sits at the four places agent work starts.
- **Consequences:**
  - **No UI control yet:** an org-level settings UI comes with sign-in (M2). Until then, pausing is an operator command.
