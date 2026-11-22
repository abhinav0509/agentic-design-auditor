# D-059: An audit log anyone can verify

- **Date:** 2026-11-22
- **Decision:** an org's audit log exports as JSON that verifies with SHA-256 alone (FR-26, NFR-10, addendum 2.8).
  - **Export (`exportAuditLog`, db):** the current org's proposal events in chain order. Each carries its readable fields, `prevHash`, `hash` and `canonical`: the event's JSON rebuilt from the stored row exactly as the chain trigger built it (migrations 0002 and 0003). An unchanged row reproduces the hashed text; a row edited later does not.
  - **Verify (`verifyAuditChain`, core):** checks each `prevHash` is the previous event's `hash` (catches removed or reordered events), each `hash = sha256(prevHash ‖ canonical)` (catches edited content and forged hashes), and that the readable fields match the canonical text (catches a doctored export). It reports the first broken event.
  - **Commands:** `pnpm fix audit <report link> > audit.json` and `pnpm audit:verify audit.json`. The real demo org's log verified: 12 events, an unbroken chain.
- **Defence in depth:** an append-only trigger already stops edits, even by a superuser (tested). The chain catches an admin who turns triggers off, and the test does exactly that.
- **Context:** FR-26, NFR-10, D-036 (the chain), M1.
- **Options:** (A) a verifier that reimplements Postgres's `jsonb::text` output; (B) the export carries the canonical text.
- **Chosen:** B. Reimplementing Postgres's JSON text output (key order, spacing, timestamp format) is fragile. With B a verifier needs only SHA-256 and a JSON parser, in any language.
- **Consequences:**
  - **Operator command for now:** org owners export through the operator command until sign-in (M2) puts it in the app.
  - **Integrity, not completeness:** the chain proves the exported events weren't changed and none are missing in the middle. Dropping the newest events can only be caught by comparing with an earlier export's last hash. Publishing the latest hash on a schedule is a Phase 3 option.
