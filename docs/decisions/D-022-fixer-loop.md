# D-022: The bounded fixer loop

- **Date:** 2026-10-31
- **Decision:** `runFixer` (`packages/agent/src/fixer.ts`) runs the v1.0 §9.2 loop against an injected, provider-neutral `LlmClient` (`llm.ts`).
  - **Finishing:** only `submit_proposal` ends a run. Its draft is one flat zod object (`kind` patch / needs_input / decline, plus `ops` or `question`), so the tool's JSON Schema is `type: object` as providers require; the kind-specific fields are checked by a refinement.
  - **Safety reuse:** a patch draft goes through core `reviseEdit` (edit ops → guard → risk). No new safety code in the agent; the model's confidence can only raise the risk.
  - **Invalid vs blocked:** a schema failure or an op aimed at no element (`EDIT_TARGET_NOT_FOUND`) goes back to the model once; the second fails the run with `INVALID_PROPOSAL`. A guard rejection ends the run as `blocked` with no retry (§9.2: a guard failure is a signal).
  - **Limits:** 8 steps, 10 s per tool, input-token budget checked before each model call (default 40 000, configurable; §9.2 says "modest"). Tool errors, timeouts, unknown tools and bad tool input come back to the model as error results and the run continues.
  - **Model errors:** end the run as `LLM_ERROR`. Retrying transient errors is the adapter's job, so a retry never repeats tool side effects here.
  - **Untrusted content (NFR-02):** page text and `get_dom_snippet` output are HTML-escaped inside `<untrusted_page_text>`, so they cannot close or forge the wrapper. Finding fields and the repo excerpt in the user prompt are escaped too.
- **Context:** Day 9 of the first-ten-days plan. No real model is called; `FakeLlm` scripts every turn.
- **Options:** (A) loop in our code over a thin client interface; (B) a provider SDK's tool runner.
- **Chosen:** A. The guard, budgets and trace must sit between every model turn and every tool call, and tests must not need a provider.
- **Consequences:** the failure reasons (`MAX_STEPS`, `BUDGET_EXCEEDED`, `LLM_ERROR`, `INVALID_PROPOSAL`) are result values, not thrown `DomainError`s. Not yet done: the 120 s job timeout (job runner), mapping a result to the §8.1 Proposal (needs IdGen, Clock and a diff renderer), path-traversal and size caps (the real `FixerTools`), and NFR-07 secret scrubbing before the first real model call.
