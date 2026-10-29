# Beacon: Source of Truth, Addendum v1.1

Date: 2026-10-29. Extends `Beacon_Product_Design_Source_of_Truth.pdf` (v1.0). Section numbers like §9.3 refer to v1.0.
New IDs continue the existing series (FR-24+, NFR-13+, D-007+). Nothing is renumbered.

When v1.0 and this addendum disagree, this addendum wins. Fold both into one document when Phase 0 ends.

---

## 0. The ten changes that matter most (ranked)

| #   | Change                                                                                                         | Why it matters                                                                                                                          | Section  |
| --- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | The agent emits **structured edit ops**, not raw diffs. Our code renders the diff.                             | Removes a whole class of patch-guard bypasses. The model can only ever write attribute _values_.                                        | A.1      |
| 2   | **Human edits go back through the guard and the verifier.**                                                    | v1.0 lets `edit_approve` skip both, so a reviewer's typo or a malicious member's edit ships unchecked.                                  | 1.1      |
| 3   | **Staleness is keyed on file content hash, not commit SHA.**                                                   | With commit SHA, any push to the repo makes every pending proposal stale.                                                               | 1.2      |
| 4   | **Fix `unique (run_id, finding_id)` on proposals.**                                                            | It makes re-propose and needs-input answers impossible (both create a second proposal for the same finding).                            | 1.3, D.1 |
| 5   | **URL ownership needs its own proof** (DNS TXT / meta tag / well-known file). A repo connection is not enough. | Otherwise anyone can connect their own repo and point Beacon at someone else's site.                                                    | 2.1      |
| 6   | **Verify the whole batch together** before opening the PR, and use one commit per proposal.                    | Proposals verified one at a time can still clash, for example two that add the same `id`. One commit each makes undo clean.             | 1.5      |
| 7   | **Org-id on every tenant table, plus Postgres row-level security (RLS).**                                      | v1.0 says "org id on every query", but `findings`, `proposals` and others have no `org_id`.                                             | 2.5, D.1 |
| 8   | **The verifier reproduces the violation locally first**, then diffs local-before against local-after.          | Comparing against the live site measures deploy drift, not our patch. If the violation doesn't reproduce locally, the mapping is wrong. | A.3      |
| 9   | **Single-key shortcuts must be toggleable** (WCAG 2.1.4).                                                      | Shipping `a/r/e/j/k` that are always on would fail the very standard we sell.                                                           | E.2      |
| 10  | **Requirement-to-test traceability in CI.** Every in-phase FR/NFR needs at least one test tagged with its ID.  | This is TDD at the product level: the spec becomes executable.                                                                          | F.2      |

---

## 1. Holes in v1.0 (fix before Day 2)

### 1.1 Edit-then-approve bypasses safety

§8.3 only guards the agent's patch. `decisions.edited_diff` is applied as written.
**Fix (FR-24):** an edit creates a new proposal _revision_. It runs guard → verifier → risk classifier. If it passes it becomes `approved`; if not, the reviewer sees the guard reason inline. The UI edits the _value_ (for example the alt-text field), not the raw diff. Raw diff editing is Phase 2+ and goes through the same pipeline.

### 1.2 Commit SHA staleness is too aggressive

**Fix:** `stale` happens only when the **target file's content hash** changes. If the commit changed but the file didn't, keep the proposal and record the new base SHA. At export, re-apply against the current file. If that fails, the proposal moves to `apply_failed`.

### 1.3 The state machine is incomplete

Missing: states for the `needs_input` and `decline` kinds, a PR closed without merging, and links between attempts. The revised table below replaces §8.3 (✚ marks a new row):

| From                           | To                                    | Trigger                                 | Guard                                                       |
| ------------------------------ | ------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| (new)                          | pending                               | passed guard + verifier                 | kind = patch                                                |
| (new)                          | blocked / failed_verification         | as v1.0                                 |                                                             |
| ✚ (new)                        | awaiting_input                        | agent asked a question                  | kind = needs_input, `question` non-null                     |
| ✚ (new)                        | declined                              | agent declined                          | kind = decline, reason code required                        |
| ✚ awaiting_input               | answered                              | reviewer answers                        | creates a new proposal with `supersedes_id` set to this one |
| pending                        | approved / rejected / stale / expired | as v1.0                                 |                                                             |
| ✚ pending                      | superseded                            | edited revision approved, or re-propose |                                                             |
| ✚ stale, expired, apply_failed | superseded                            | re-propose                              | new attempt created                                         |
| approved                       | applied / apply_failed                | as v1.0                                 |                                                             |
| ✚ applied                      | closed_unmerged                       | PR closed without merge (webhook)       | can be re-exported                                          |
| applied / merged               | reverted                              | as v1.0                                 |                                                             |

Terminal states: rejected, declined, superseded, reverted, blocked, failed_verification. The property test (§8.3) must cover the full table.

### 1.4 Idempotency semantics are under-specified

The same key with a **different payload** must return `422 IDEMPOTENCY_KEY_REUSED` (Stripe semantics). Store a hash of the request body with the key. Idempotency rows live 24 hours at minimum.

### 1.5 A batch is not a set of independent patches

Each proposal is verified alone, but a batch can collide (duplicate ids, overlapping line ranges).
**Fix (FR-25):** the exporter applies the batch in a stable order, re-runs the guard on the combined result, then runs the verifier once on the combined tree. The PR has **one commit per proposal** (the trailer `Beacon-Proposal: <id>` makes it traceable). Undoing one proposal before merge drops its commit with a revert commit on the branch. After merge, it opens a revert PR for that commit only.

### 1.6 Expiry needs no cron to be correct

Check `expires_at` **at decision time** in the same transaction. The pg-boss sweep only keeps the UI tidy; correctness never depends on it.

### 1.7 "Simple templates" is undefined

**Decision D-007:** for the MVP, only files that are **served as-is** count: the URL path maps to a repo file with no build step. The mapper confirms this by fetching the URL and comparing it to the repo file after normalisation. Templates (Jekyll, 11ty, and so on) move to Phase 2 with their own mutation corpus.

### 1.8 Generated text must match the page language

The alt text and label text must be written in the document's language. For pages without `lang` (one of our own rules), detect the language deterministically (franc or similar). If detection and the model disagree, the agent returns `needs_input`.

---

## 2. Security and safety hardening

### 2.1 Site ownership (replaces the FR-04 wording)

**FR-04a:** before the first scan, the user proves control of the **URL** with one of: a DNS TXT record (`beacon-verify=<token>`), a `<meta name="beacon-verification">` tag, or `/.well-known/beacon-verification.txt`. Re-check every 30 days and before scheduled scans. The repo connection proves control of the repo, which is a separate fact.

### 2.2 SSRF: enforce at the network layer, not just in app code

Playwright loads sub-resources, redirects, iframes and websockets that an app-level URL check never sees.

- Run the scanner in a container whose **only egress is an allowlisting proxy**. The proxy resolves DNS once, pins the IP, and blocks RFC1918, loopback, link-local (incl. `169.254.169.254`), CGNAT `100.64/10`, `0.0.0.0/8`, IPv6 ULA/link-local, and IPv4-mapped IPv6.
- Also intercept with `page.route('**')` in Playwright (defense in depth): http/https only, no `file:`, `data:` top-level, or `blob:` navigation.
- Test corpus: decimal/octal/hex IPs, `localhost.` with a trailing dot, DNS rebinding (a test resolver that flips answers), 30x redirect to a private address, and an `<iframe>` to the metadata IP.

### 2.3 Beacon never executes customer code (D-008)

The verifier serves the checkout with a **static file server only**. It never runs `npm install`, a build or a script from the repo. If builds are ever needed (Phase 4), they run in an ephemeral microVM (Firecracker or gVisor) with no network access and its own decision record.

### 2.4 Generated content is untrusted output

The model's attribute values get validated by code before any rendering:

- Escape with our own serializer (never string concatenation).
- Allowed shape: max 250 chars (alt) / 120 (label). No `<`, `>`, URLs, `javascript:`, control characters or bidi overrides (`U+202A–202E`, `U+2066–2069`).
- Blocklist check for slurs and profanity. A hit raises the proposal to `high` and flags it.
- PR title and body are built from **our templates**. Model text appears only quoted inside fenced blocks, never as raw markdown (it could hide links or @-mentions).

### 2.5 Tenant isolation

- Add `org_id` to every tenant table (see D.1). Enable **RLS** with `org_id = current_setting('app.org_id')::uuid`. The app sets this per transaction from the session. The app DB role is not the owner and has `NOBYPASSRLS`.
- Workers run under the same role and set `app.org_id` from the job payload. The job's org is re-checked against the DB row.
- Authorisation matrix test: for every route × role × (own org, other org), assert the expected status code. Generated from a table, so new routes fail CI until they are added.

### 2.6 GitHub App specifics

- `contents: write` **cannot be scoped to non-default branches**. The rule against writing to the default branch is enforced in our code. The exporter fetches the _live_ default branch name right before each push (never cached) and refuses `refs/heads/<default>`, plus any branch not matching `beacon/*`. Ask users to enable branch protection, and show its status in the UI.
- Permissions: `contents: write`, `pull_requests: write`, `metadata: read`. Nothing else.
- The webhook checks `X-Hub-Signature-256` with a constant-time compare, deduplicates on `X-GitHub-Delivery` (replay protection), and enqueues the work rather than processing it inline.
- The App private key lives in a KMS or secret manager. Installation tokens (1-hour lifetime) are minted per job and never stored.

### 2.7 Auth and web hardening

- Sign-in uses **GitHub OAuth only** for the MVP (one identity, no passwords to store). Sessions are server-side, in `httpOnly; Secure; SameSite=Lax` cookies, and rotate on login.
- CSRF: Origin/`Sec-Fetch-Site` check on every non-GET API route.
- Strict CSP with nonces, `frame-ancestors 'none'`, HSTS, and `Referrer-Policy: strict-origin-when-cross-origin`.
- Screenshots are **rendered in a sandboxed origin or as images only**, never as live customer HTML inside our app. The before/after preview is a PNG, not an iframe of customer markup.
- Rate limits: per-IP on auth, per-org on scans and model spend.

### 2.8 Audit log tamper-evidence

Each `proposal_events` row stores `prev_hash` and `hash = sha256(prev_hash || canonical_json(row))`, chained per org. An export includes the chain, and a verifier script checks it. This costs a few lines and turns "append-only" into a property anyone can check.

### 2.9 Secrets sent to the model

Use the gitleaks rule set (vendored, pinned) for scrubbing excerpts. Never send files matching `.env*`, `*.pem`, `*.key`, `id_*`, or anything in `.gitignore`. Excerpts are capped at N lines around the target. Test: plant 50 secret formats in fixture files and assert none reach `FakeLlm.calls`.

### 2.10 Supply chain

pnpm with a frozen lockfile and `onlyBuiltDependencies` (an allowlist for install scripts). Renovate with a 7-day minimum release age. GitHub Actions pinned by SHA. CodeQL, OSSF Scorecard, an SBOM per release, and npm provenance when Review Kit is published.

### 2.11 Privacy and data lifecycle

- Screenshots can contain customer PII. Store them in a per-org blob prefix, behind short-lived signed URLs, with 30-day retention by default.
- **Hard delete** pipeline: deleting a site or org purges blobs, findings and proposals after a 14-day grace period. The audit log keeps hashes plus actor and time, without content.
- Before pilots: a DPA template, a subprocessor list (model provider, hosting, blob storage), and use of the model provider's zero-retention option where available.

---

## A. Agent and verification design upgrades

### A.1 Edit ops instead of diffs (D-009)

`submit_proposal` takes a list of ops:

```ts
type EditOp =
  | { op: 'set_attr'; target: SourceLoc; name: AllowedAttr; value: string }
  | { op: 'remove_attr'; target: SourceLoc; name: AllowedAttr } // e.g. bogus empty aria-label
  | { op: 'wrap_label'; target: SourceLoc; text: string }; // only for the label rule
// SourceLoc = { file, startOffset } from parse5 sourceCodeLocationInfo
```

Our code applies the ops through a parse5-located edit and renders a unified diff for the Proposal contract, so **Review Kit and §8.1 don't change**. The guard still checks the rendered diff (defense in depth), but the main guarantee is structural: there is no op that can add a `<script>`.

### A.2 Guard on the parsed tree, not just lines

Parse the file before and after. Compute the tree diff. Allowed: only the attribute changes and the element insertions that the rule's allowlist permits. Also enforce `id` uniqueness per document, and that no element is removed or reordered (the "MUST NEVER" list in §6.2 becomes executable). Reason codes come from an enum, one test per code.

### A.3 Verifier protocol

1. Static-serve the **unpatched** checkout. Render with a fixed viewport, `prefers-reduced-motion`, animations disabled, a frozen clock, and blocked third-party origins.
2. **Reproduce the finding.** If it doesn't reproduce, the result is `UNMAPPED_LOCAL_MISMATCH`: no patch, report only.
3. Render twice to measure the **noise floor**, then mask the regions that differ.
4. Apply the patch, render, and re-run axe. The target violation is gone and the count of other violations (by fingerprint) has not grown.
5. Visual diff above `max(threshold, noise × k)` raises risk to high. Above a hard cap it fails.

### A.4 Engine version is part of the run

Pin the axe-core version. Store `engine_version` on `scan_runs`. Fingerprints exclude the engine version, so regression detection survives upgrades. Engine upgrades go through the mutation corpus first.

### A.5 Handle axe `incomplete` results

They become L0 report items ("needs a human check"), never proposals. This feeds FR-17 for free.

### A.6 Provider resilience

LlmClient applies per-org concurrency limits and retries with jitter on 429/529 errors. During a provider outage, scans and reports still work (L0). Fix jobs wait in the queue with a visible "waiting for model" state.

---

## D. Data model changes

### D.1 DDL delta (apply in the first migration; don't migrate later)

```sql
-- IDs: uuidv7() (Postgres 18) or app-generated v7. Time-sortable, better index locality.

alter table sites add column ownership_token text, add column ownership_verified_at timestamptz;
alter table site_connections add column org_id uuid not null references organizations(id);
alter table scan_runs   add column org_id uuid not null references organizations(id),
                        add column engine_version text not null;
alter table pages       add column org_id uuid not null references organizations(id);
alter table findings    add column org_id uuid not null references organizations(id);

alter table proposals
  add column org_id uuid not null references organizations(id),
  add column attempt int not null default 1,
  add column supersedes_id uuid references proposals(id),
  add column target_file_hash text not null,          -- staleness key (1.2)
  drop constraint proposals_run_id_finding_id_key,
  add constraint proposals_attempt_uniq unique (run_id, finding_id, attempt);
-- also extend the status check: awaiting_input, answered, declined, superseded, closed_unmerged

alter table proposal_events
  add column org_id uuid not null,
  add column prev_hash bytea, add column hash bytea not null;   -- 2.8

alter table decisions add column org_id uuid not null,
                      add column request_hash bytea not null;   -- 1.4
alter table exports   add column org_id uuid not null,
                      add constraint exports_status_chk check (status in ('pending','pushed','pr_open','failed'));

create table agent_traces (           -- missing DDL in v1.0
  id uuid primary key, org_id uuid not null, run_id uuid not null references scan_runs(id),
  finding_id uuid not null references findings(id), proposal_id uuid references proposals(id),
  step int not null, tool text not null, input_ref text, output_ref text,
  latency_ms int, error_code text, created_at timestamptz not null default now()
);
create table usage_ledger (
  id bigint generated always as identity primary key, org_id uuid not null, run_id uuid,
  kind text not null check (kind in ('model','scan_page','verify')), units bigint not null,
  cost_micros bigint not null, created_at timestamptz not null default now()
);
create table outbox (                  -- transactional outbox for GitHub side effects
  id bigint generated always as identity primary key, org_id uuid not null,
  topic text not null, payload jsonb not null, dedupe_key text not null unique,
  processed_at timestamptz, created_at timestamptz not null default now()
);
-- RLS on every table carrying org_id; append-only triggers on proposal_events, decisions, usage_ledger.
```

### D.2 Transactional outbox for exports

A decision commits the state change and the outbox row in **one transaction**. A worker drains the outbox and calls GitHub, with idempotency from the deterministic branch name `beacon/<run-short>/<batch-hash>`. A crash at any point neither loses a PR nor creates two. NFR-03 becomes provable with a "kill the worker at every step" test.

### D.3 Migrations

Migrations are forward-only and follow expand/contract. Each one runs in CI against a snapshot of the previous schema with seed data. Restoring a backup is tested before Phase 3 (already in v1.0) and also once in Phase 1 on staging.

---

## B. API additions

- `POST /api/proposals/:id/revisions`: reviewer edit → new revision → guard and verifier (FR-24). It returns 422 `GUARD_FAILED` with the reason code.
- `POST /api/proposals/:id/answer`: answers a needs_input proposal and enqueues the re-run.
- `POST /api/sites/:site/ownership/check`.
- `GET /api/runs/:run/events` (SSE) instead of polling.
- New error codes: `IDEMPOTENCY_KEY_REUSED`, `OWNERSHIP_UNVERIFIED`, `PROPOSAL_EXPIRED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `UNMAPPED_LOCAL_MISMATCH`.
- Errors use RFC 9457 (`application/problem+json`), keeping `code` as an extension member, so the `{code, message, details}` shape survives.
- The OpenAPI spec is generated from the same zod schemas, so it can't drift.

---

## E. UX and design: the "world-class" bar

### E.1 Design language (decide in Phase 0, D-010)

- **Components:** Radix primitives (accessible behaviour) styled with Tailwind via design tokens. shadcn/ui as source we own, not a dependency.
- **Tokens:** color, space, radius, type and motion as CSS variables. Light and dark themes. Every text/background pair is checked for AA contrast **by a unit test over the token file**.
- **Type:** one UI sans plus one mono for diffs. Tabular numbers in counts and costs.
- **Risk is never color alone:** icon + label + color (low / medium / high / blocked).
- **Motion:** 150–200 ms, purposeful (queue advance, decision confirm). Fully disabled under `prefers-reduced-motion`.
- **Signature moment:** the queue. One proposal fills the view: before/after screenshots with the element highlighted, the plain-language change ("Adds alt text: _Founder holding the product_"), a risk chip with reasons, verification ticks, and keys shown inline. Clearing 20 low-risk items should feel like inbox zero.

### E.2 Accessibility of Beacon itself (raises NFR-06)

- Single-key shortcuts have a **settings toggle** and only work while the queue has focus (WCAG 2.1.4). `?` opens the shortcut sheet.
- Diffs come with a **semantic summary** for screen readers ("alt attribute added on image in hero section, value: …"). Raw red/green diffs are unusable with assistive tech.
- After each decision, focus moves to the next proposal and an `aria-live="polite"` region announces it ("Approved. 7 left.").
- Target size is 24×24 minimum (WCAG 2.5.8). Focus is never obscured (2.4.11).
- Manual check per phase: a VoiceOver and NVDA pass of the main journey, logged in docs/. Automated axe checks are necessary but not enough, and our own honesty rule (§1.4) applies to us too.

### E.3 Empty, loading and error states

Every screen in §12.2 has five designed states: empty, loading (skeleton), partial, error, and success. These are Storybook stories, and stories are tests (E2E §F).

### E.4 Positioning note

"Fixes in your source, reviewed by you, delivered as a PR" is the differentiator against accessibility **overlays**, which the a11y community distrusts and regulators have criticised. Say this plainly on the landing page, and add "we are not an overlay" to the honesty rules. Market timing: the European Accessibility Act has applied since 28 June 2025.

---

## C. Engineering platform (closes v1.0's open choices)

| Concern            | Decision                                                                                                                               | Why                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Monorepo           | pnpm workspaces + Turborepo                                                                                                            | Cached task graph, the standard choice for TS monorepos      |
| TS                 | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`                                                                     | Catches the bugs tests would otherwise need to               |
| Lint/format        | typescript-eslint (strict-type-checked) + Prettier                                                                                     | Most mature rule set                                         |
| Runtime validation | **zod v4** as the single source; `z.toJSONSchema()` emits the Proposal JSON Schema                                                     | One schema for API, DB payload, adapter and docs             |
| ORM                | **Drizzle**                                                                                                                            | SQL-close, works well with RLS and raw SQL, no engine binary |
| Queue              | pg-boss (as v1.0) + outbox (D.2)                                                                                                       |                                                              |
| Determinism        | Inject `Clock`, `IdGen`, `LlmClient`, `GitProvider`, `BlobStore` everywhere                                                            | Every test becomes deterministic                             |
| Observability      | OpenTelemetry (GenAI semantic conventions for model spans) + pino with redaction + Sentry                                              | Trace per run (NFR-08) for free, vendor-neutral              |
| Hosting (proposal) | Web on Vercel; worker + scanner on Fly.io machines (scanner in its own app, egress proxy only); Neon Postgres; Cloudflare R2 for blobs | Answers open question 19.2 #1. Scanner part: see D-017       |

Record each choice as `docs/decisions/D-0xx.md` with the versions checked on the day you lock them (§7.4).

---

## F. How TDD is built into the workflow

v1.0 §16 is the inner loop. This adds the outer loop, the safety-specific testing and the guardrails for the AI assistant.

### F.1 Two loops

- **Outer loop (acceptance, ATDD):** before starting a requirement, write one failing acceptance test named with its ID: `it('FR-13: rejects decision on stale proposal with 409', …)`. It stays red while the inner loop runs.
- **Inner loop (unit):** Red → Green → Refactor as in §16.1, until the acceptance test passes.

### F.2 Traceability as a CI gate

`pnpm trace` scans test names for `FR-\d+|NFR-\d+`, joins them with a `requirements.yaml` (id, phase, text), and fails CI when an in-phase requirement has no test. It writes `docs/traceability.md` on each main build. The spec becomes a checklist that enforces itself.

### F.3 Abuse cases are tests first

Every threat row in §14 and §2 of this addendum starts as a **failing misuse test** before the mitigation exists, for example `it('NFR-09: blocks redirect to 169.254.169.254')`. Security work follows the same red/green cycle as features.

### F.4 Stronger tests on security-critical code

| Package                              | Extra gate                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| core (state machine, risk, decision) | Property tests over the full transition table. **Stryker mutation score ≥ 85%** (blocking, not optional)                                |
| guard                                | Fuzzing with fast-check over a hostile-HTML generator + vendored XSS payload corpus. Mutation score ≥ 90%. Each reason code has a test. |
| scanner URL safety                   | Table tests over the bypass corpus (2.2) + DNS rebinding test resolver                                                                  |
| db                                   | Testcontainers Postgres 18. **RLS cross-tenant matrix**. Append-only triggers tested (UPDATE/DELETE must throw)                         |
| exporter                             | FakeGitProvider + a "crash at every step" test for the outbox                                                                           |
| review-kit                           | Storybook stories = component tests (interaction + axe). Keyboard tests. Visual snapshots only for diff view and risk badge             |
| contract                             | The Proposal JSON Schema snapshot is committed. CI fails on a breaking change unless `schema_version` is bumped                         |

### F.5 Test infrastructure, built in Phase 0

`packages/testkit`: builders (`aProposal().pending().v(3).build()`), `FakeClock`, `SeqIdGen`, `FakeLlm` (scripted + recording replay), `FakeGitProvider`, `InMemoryBlobStore`, `InMemoryReviewAdapter`, and a Postgres fixture that resets a template DB per test file. Builders keep tests readable and stop setup code from rotting.

### F.6 Rules for the AI coding assistant (makes §16.2 enforceable)

1. Commits are separate: `test:` (red, reviewed by you) comes before `feat:` (green). The assistant never changes an existing assertion in a `feat:` commit.
2. CI check: a `feat:`/`fix:` commit that modifies lines in `*.test.ts` that were not added in the same PR fails, with an override label `test-change-approved`.
3. Optional Claude Code hook: a PreToolUse hook that blocks edits to `*.test.ts` while `.tdd-phase` contains `green`.
4. See `CLAUDE.md` at the repo root for the working agreement.

### F.7 Evals get a TDD shape too

- Before tuning a prompt, add the failing eval case(s) that describe the problem.
- Report results with **confidence intervals** (n is small; 30 cases is noisy). Gates compare against the main baseline with a paired test, not raw thresholds alone.
- Pin the exact model snapshot in config. Each eval run records model, prompt hash, corpus hash, engine version and judge version.
- The eval budget is a config value. CI fails fast if a run would exceed it.

---

## G. Operations and compliance additions

- **NFR-13 Availability:** the review UI aims for 99.5% monthly in Phase 3. RPO 1 h, RTO 4 h. Postgres PITR enabled.
- **NFR-14 Security disclosure:** `security.txt`, a disclosure policy, and an external pen test before public launch (Phase 3 gate).
- **NFR-15 Data lifecycle:** retention and hard-delete as in 2.11, with a DSAR export per org.
- **NFR-16 Tenant isolation:** RLS on all tenant tables, enforced by the matrix test (2.5).
- **NFR-17 Supply chain:** as in 2.10. Nightly dependency audit opens issues (already in v1.0 stage 7).
- **FR-26:** org owners can export the audit log with a verifiable hash chain (2.8).
- **FR-27:** a shareable report link uses an unguessable token, expires (default 30 days) and can be revoked.
- **FR-28:** an org-level kill switch pauses all agent activity (fix jobs, exports) at once.

---

## H. New decisions

| ID    | Decision                                                  | Reason                                    |
| ----- | --------------------------------------------------------- | ----------------------------------------- |
| D-007 | MVP maps only served-as-is files; no build-step templates | Keeps mapping provable (1.7)              |
| D-008 | Beacon never executes customer code                       | Removes RCE as a class of risk            |
| D-009 | Agent emits edit ops; code renders diffs                  | Safety by construction (A.1)              |
| D-010 | Radix + Tailwind tokens; AA contrast unit-tested          | Accessible by default, consistent look    |
| D-011 | zod v4 single schema source; Drizzle; pnpm + Turborepo    | Closes §7.4 choices                       |
| D-012 | RLS + org_id denormalised on every tenant table           | Defense in depth for tenant isolation     |
| D-013 | Transactional outbox for every external side effect       | Proves NFR-03                             |
| D-014 | Staleness keyed on target-file content hash               | Avoids mass staleness on unrelated pushes |

---

## I. Revised first ten days (changes in **bold**)

| Day | Do                                                                                                      | Test first                                                                              |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Repo, pnpm/Turbo, TS strict, Vitest, CI stages 1–2, **requirements.yaml + `pnpm trace`**, **CLAUDE.md** | CI fails red, then passes. **Trace fails on an untested Phase-0 requirement.**          |
| 2   | Proposal zod schema → JSON Schema; **testkit builders, FakeClock, SeqIdGen**                            | Schema accepts the §8.1 example and rejects bad cases. **Schema snapshot committed.**   |
| 3   | **Full** state machine table (1.3)                                                                      | Table-driven + property test over all pairs                                             |
| 4   | Decision logic: idempotency **with request hash**, version, stale, **expiry at decision time**          | §16.5 tests + 1.4 + 1.6                                                                 |
| 5   | Risk classifier + **edit-op applier + tree-diff guard**                                                 | Guard reason-code tests, fuzz test, risk monotonic property                             |
| 6   | Corpus v0 + mutation script. **Hosting spike: price the scanner sandbox and egress proxy.**             | Mutation is deterministic                                                               |
| 7   | Scanner on corpus **+ URL-safety bypass corpus**                                                        | Detects every injected violation, flags nothing on clean pages, **blocks every bypass** |
| 8   | Fingerprint + dedupe; **DB schema with RLS + matrix test**                                              | Dedupe tests; **cross-tenant reads return 0 rows**                                      |
| 9   | Fixer loop with FakeLlm, **edit-op `submit_proposal`**                                                  | Loop tests, budgets, injection handling                                                 |
| 10  | First real model run, recordings, first eval report **with CIs**                                        | Eval runner writes a comparable report                                                  |

---

## J. Questions only you can answer

1. **Employer IP (§19.1):** have you checked your contract's invention-assignment clause? Do this before Day 1. It's the one risk that can't be fixed after the fact.
2. Is the Review Kit's open-source licence MIT or Apache-2.0? (Apache-2.0 gives a patent grant.)
3. Hosting region for EU pilots: EU-only data residency from day one, or later?
4. Will pilots accept GitHub-only sign-in?
