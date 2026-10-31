# D-023: Secret scrubbing before the model

- **Date:** 2026-10-31
- **Decision:** every untrusted text bound for the model goes through `scrubSecrets` (`packages/agent/src/scrub.ts`): the prompt's selector, snippet, path, source excerpt and page text, every string tool result and every tool error message. The rules are the gitleaks v8.30.1 default config, vendored at `packages/agent/vendor/gitleaks-v8.30.1/gitleaks.toml` and pinned by a SHA-256 test, translated to JS regexes at load.
  - **Gitleaks semantics kept:** the secret is the configured group, else the first non-empty group, else the whole match; a match at or below the rule's entropy is not a secret. Overlapping matches are merged and replaced by `[REDACTED_SECRET]`.
  - **Skipped, on purpose:** keyword prefilters and allowlists. Both only stop matches, so skipping them can only redact more. No false positives on the clean corpus or on form markup that uses words like key and password.
  - **Go → JS:** `(?P<` → `(?<`, `\z` → `$`, `[[:alnum:]]` → `[a-zA-Z0-9]`; a mid-pattern `(?i)` or `(?s)` becomes a whole-pattern flag (widens matching only). `(?i:…)`, `(?-i:…)` and `(?s:…)` work natively in Node 24. All 221 regex rules compile.
  - **HTML boundary pass:** gitleaks rules end a token at a quote, space or line end, so a token followed by a tag (`key</p>`) is missed. Text containing `<` or `>` gets a second pass with both replaced by spaces (same length, so match positions map back onto the original). Found by the local demo.
  - **Never read:** `.env*`, `*.pem`, `*.key`, `id_*` (any case). `read_file` refuses them before calling the tool.
  - **Size cap:** untrusted text over 32 000 chars is not sent (tools get an error asking for a line range; page text is replaced by a note). Truncating instead could leave half a secret.
- **Context:** addendum 2.9 and NFR-07; must hold before the first real model call (Day 10).
- **Options:** (A) translate the rule file to JS in-process; (B) run the pinned gitleaks binary on each text (`gitleaks stdin`); (C) our own pattern list.
- **Chosen:** A. Exact gitleaks rules without a native binary in the worker or a subprocess per tool result. C would drift from the maintained rule set.
- **Consequences:** JS regexes backtrack where Go's RE2 does not. Measured worst case is linear at about 38 ms per KB (hostile `[\w.-]{0,50}?` prefixes), so the cap bounds one text to about 1.2 s per pass (two passes for HTML). Upgrading gitleaks means replacing the file and its pinned hash and rerunning the 50-secret test. Files listed in the repo's `.gitignore` must be refused by the real repo tools, which can see it. Planted test secrets are stored reversed (fixtures/secrets/README.md), so no secret scanner needs an allowlist.
