# D-025: The Anthropic LlmClient adapter

- **Date:** 2026-10-31
- **Decision:** `AnthropicLlm` (`packages/agent/src/anthropic.ts`) implements `LlmClient` over `client.beta.messages.create` with `@anthropic-ai/sdk` 0.137.0.
  - **Config (NFR-12):** `BEACON_FIXER_MODEL` (default `claude-opus-5-5`, owner's choice) and `BEACON_FIXER_EFFORT` (default `medium`, Opus 5.5's own default, set explicitly). `models.ts` holds each model's price; a model without a price is refused so budgets always hold.
  - **Cost (NFR-05):** cost in micro-dollars from uncached input, cache writes (1.25×), cache reads and output at the configured prices. All input the model read, cached or not, counts against the token budget.
  - **Thinking:** Opus 5.5 always thinks, and thinking blocks must go back unchanged. `LlmTurn.raw` carries the provider content; `runFixer` keeps it on the assistant message; the adapter resends it verbatim.
  - **Caching:** the system prompt is the stable prefix (`cache_control: ephemeral`).
  - **Failures:** `refusal` and `max_tokens` stop reasons fail the call (no half-written tool call runs). The SDK retries transient errors once (`maxRetries: 1`, v1.0 §9.2); after that `runFixer` reports `LLM_ERROR`.
  - **Fallbacks:** server-side refusal fallback (`fallbacks: 'default'`) is on, as the Claude API guidance recommends for Opus 5.5. The eval runner records which model served each turn.
  - **No forced tool choice:** a 400 on Opus 5.5. The prompt says `submit_proposal` is the only way to finish, and `runFixer` reminds the model on a text-only turn.
- **Context:** Day 10, first real model run. The key comes from `ANTHROPIC_API_KEY` in the owner's shell (or an `ant` profile); it never enters the repo.
- **Options:** SDK 0.137.0 (last 0.x, 11 days old) vs 1.3.0 (new major, 8 days old).
- **Chosen:** 0.137.0. It has every API feature used here; a major upgrade waits for its own change.
- **Consequences:** prices in `models.ts` must be updated by hand when Anthropic changes them. `strict: true` tool schemas are not used, because zod's optional fields are not in `required`; inputs are validated by zod in `runFixer`.
