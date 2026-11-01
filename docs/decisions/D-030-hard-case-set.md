# D-030: The hard-case set and restraint

- **Date:** 2026-11-01
- **Decision:** `fixtures/corpus/hard/` holds hand-written pages, one violation each, labelled in `cases.json` with what a good answer is: an alt matching a case-insensitive pattern, or `ask` (a question or a decline). `loadHardCases()` (`@beacon/evals`) loads them; `pnpm eval` runs them after the corpus cases. Their images are drawn in code like the corpus images (D-028) and listed in `hard-manifest.json`.
  - **First slice (7):** decorative divider (`alt=""`), logo and opening-hours poster (text in image), basket icon link (names the function), and three must-ask cases: a QR code with no hint where it leads, a chart with no labels or data, and a field named `ref2`.
  - **Metrics (v1.0 §15.2):** _restraint_ = must-ask cases answered with a question or decline (gate 80%+); _forced bad fixes_ = must-ask cases patched (gate 0); _hard fixes_ = other hard cases whose alt matches the label. Hard cases are left out of validity and effectiveness.
- **Context:** v1.0 §15.1 lists hard cases (text in images, decorative vs informative, icon buttons, repeated templates, injections). Prompt v3 (D-029) tightened the decorative rule with no case measuring over-description.
- **Options:** derive hard cases by mutating clean pages vs hand-written pages.
- **Chosen:** hand-written, because the label depends on the page around the element (a QR code with no context, a field with no text), which mutation cannot set up.
- **Consequences:** seven cases give wide intervals; the set grows towards v1.0's size with a holdout slice. Repeated templates and judge-scored quality are not covered yet. Labels are written before any run, so they are not tuned to the model.
