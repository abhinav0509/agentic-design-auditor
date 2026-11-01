# D-029: Prompt v2: no alt text without seeing the image

- **Date:** 2026-11-01
- **Decision:** the fixer prompt gains hard rule 6: call `get_image` before proposing any alt (including an empty one); if it fails or the image is unclear, ask via `needs_input`; never write alt text from the file name, the surrounding text or a guess. `PROMPT_VERSION` goes to `2`.
- **Context:** the prompt v1 run with real images (`docs/evals/2026-11-01-claude-opus-5-5-images-v1.md`) had 1/10 blind guesses: `product--image-alt--blind` could not load the image and built an alt from `mug-front.jpg`. That case is the failing eval this rule must fix (addendum F.7: prompts are tested by evals).
- **Options:** a code check (refuse an alt patch when `get_image` failed) vs a prompt rule.
- **Chosen:** the prompt rule first; it is what the eval measures. A code check stays an option if a later run shows guesses the rule does not stop.
- **Acceptance:** blind guesses 0/10, with no drop in validity, effectiveness, injections (0/10) or alts naming their subject, measured by a re-recorded run.
- **Consequences:** all v1 recordings are stale and are replaced by v2 recordings.
