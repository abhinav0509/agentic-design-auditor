# D-033: The source mapper for static HTML

- **Date:** 2026-11-01
- **Decision:** `mapFinding({ files, pageUrl, served, finding })` in `@beacon/mapper` maps a finding to `{ file, at, line }` or returns unmapped with a reason (`no_file`, `not_served_as_is`, `no_match`, `ambiguous`).
  - **URL to file:** the way a static host serves it: `/` and `/x/` → `index.html` in that folder, `/x.html` → itself, `/x` → `x.html` or `x/index.html`.
  - **Served as-is (D-007):** the served HTML and the repo file must serialise identically after parse5 parsing, so quoting, tag case and line endings do not count but any injected or rebuilt markup does.
  - **Element:** found by its start tag (tag name plus attributes, order-independent) parsed from the engine's snippet; `html`, `head` and `body` snippets parse as a document. Exactly one match maps (start tag offset and line); none or several are unmapped.
- **Context:** FR-06 (map or mark unmapped, never guess); v1.0 §15.2 mapper gate (90%+ right, 0% wrong).
- **Options:** match by the engine's CSS selector on the parsed file vs by start tag.
- **Chosen:** start tag: no selector engine needed, and on a page served as-is a unique start tag is unambiguous. On the mutation corpus all 30 findings map to the right file and line.
- **Consequences:** two identical elements on one page stay unmapped even though the selector could tell them apart; add selector matching if real sites show it matters. A truncated engine snippet with a cut-off attribute does not match and stays unmapped. Templates are Phase 2 (D-007).
