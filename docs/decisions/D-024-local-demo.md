# D-024: A local engine demo before the Review Kit

- **Date:** 2026-10-31
- **Decision:** `pnpm demo` (`tools/demo`) serves a local-only page (127.0.0.1) that runs the real scanner, fixer loop, scrubbing, guard, risk and decision code on corpus pages, with a scripted model. Scenarios: fix, malformed-then-retry, needs_input, obeyed injection (guard blocks), and a key in the page (scrubbed).
- **Context:** the owner asked to see the work in a browser; the Review Kit is Phase 1 work after Day 10.
- **Options:** (A) a dev-only demo over the real packages; (B) wait for the Review Kit; (C) start the Review Kit now.
- **Chosen:** A (owner's choice). Small, reuses every package as is, and showed a real gap on its first run (a secret followed by an HTML tag escaped scrubbing; fixed in D-023).
- **Consequences:** not product code. State lives in memory; dates come from the system clock; verification is skipped, so a guarded patch goes straight to `pending`. Only corpus pages are scanned, every other request is aborted, and previews render under `default-src 'none'` in a sandboxed iframe (D-020: the scanner never sees untrusted URLs outside the sandbox). `pipeline.test.ts` keeps it working.
