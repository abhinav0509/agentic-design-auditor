# D-015: Test helpers live in core until a second package needs them

- **Date:** 2026-10-29
- **Decision:** Postpone `packages/testkit` (addendum F.5). Builders and fakes start in `packages/core/src/test-helpers.ts`, as in the v1.0 §16.5 example.
- **Context:** The proposal builder needs core's types and core's tests need the builder. A separate package now would create a core ↔ testkit cycle.
- **Options:** (A) testkit now and accept the workspace cycle; (B) helpers inside core, extracted later.
- **Chosen:** B. No cycle and no extra package to maintain yet.
- **Revisit:** when a second package (db, agent or verifier) needs the builders. Extract then, with core as testkit's only dependency.

Related contract notes from Day 2 (approved 2026-10-29):

- A `needs_input` question is `{ text, options[] }`.
- `risk` is required only for `patch`. It's optional for `needs_input` and `decline`.
- `attempt` and `supersedes_id` are DB columns, not contract fields. The contract stays as §8.1.
- The exported JSON Schema can't express two refinements: `range.end_line >= start_line` and `expires_at > created_at`. Non-TypeScript consumers must check them, or call our API.
