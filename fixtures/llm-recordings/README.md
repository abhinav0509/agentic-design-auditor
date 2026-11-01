# LLM recordings

Real model turns, recorded once per scenario and replayed in tests (v1.0 §16.6, D-026). File name: `<scenario>.prompt-v<N>.json`.

- Each turn stores the SHA-256 of the request that produced it. If the prompt, tools or input change, replay fails as stale; re-record on purpose.
- Corpus pages only, never customer data. Files are scrubbed of secrets before they are written (NFR-07).
- Recordings test our handling of model output. They do not measure model quality; evals do.
