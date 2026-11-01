# D-026: Recording format and staleness

- **Date:** 2026-11-01
- **Decision:** `RecordingLlm` wraps a real `LlmClient` and saves `fixtures/llm-recordings/<scenario>.prompt-v<N>.json` (scenario, model, prompt version, turns). Each turn stores a SHA-256 of its request, not the request. `ReplayLlm` returns the turns in order and fails when a request's hash differs ("stale recording …; re-record it") or when more turns are asked for than were recorded.
- **Context:** v1.0 §16.6: replay real responses in tests; a prompt change must make a recording fail and force a conscious re-record.
- **Options:** (A) hash each request; (B) store full requests and diff; (C) key only on the prompt version.
- **Chosen:** A. It catches any change (prompt, tool schema, input, earlier turns), keeps files small, and avoids storing page and file content twice in git. C would miss tool and input changes. B gives a nicer diff but duplicates content.
- **Consequences:** the hash is taken over the scrubbed request, so recording (raw turns) and replay (scrubbed turns) agree. Saved files are scrubbed (NFR-07). A stale error names the step but not what changed; re-recording is the fix either way.
