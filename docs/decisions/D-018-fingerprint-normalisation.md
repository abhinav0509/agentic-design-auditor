# D-018: What counts as "the same violation" in a fingerprint

- **Date:** 2026-10-30
- **Decision:** `fingerprint = sha256(rule_id \0 selector \0 sha256(snippet))` (v1.0 §9.1 step 3). The selector has whitespace runs collapsed. The snippet is parsed with parse5 as a fragment and re-serialised with attributes sorted by name and text whitespace runs collapsed and trimmed. Page URL, impact and engine version (addendum A.4) are excluded.
- **Context:** Fingerprints are stored on `findings` and drive dedupe across pages, verifier counts (addendum A.3) and regression detection across runs (FR-21). Any change to normalisation re-keys every stored finding.
- **Options:** (A) hash the raw snippet; (B) parse and canonicalise; (C) canonicalise and also strip volatile attributes (ids, nonces, hashed class names).
- **Chosen:** B. A treats reformatting as a new violation. C guesses at which attributes are volatile and could merge real distinct violations.
- **Consequences:** `<html>`, `<head>` and `<body>` drop out of a fragment parse, so those snippets hash as empty; rule + selector still identify them. Text whitespace is not significant to the fingerprint, though it can be in `<pre>`.
- **Revisit:** if template-driven sites show per-page volatile attributes splitting one violation into many findings. Any change needs a migration that re-fingerprints stored findings.
