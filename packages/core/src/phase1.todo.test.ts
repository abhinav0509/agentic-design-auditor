// Phase 1 test list (v1.0 §16.4 + addendum). Turn each todo into a real test, one at a time,
// and move it next to the code it covers once that package exists.
import { describe, it } from 'vitest';

describe('state machine', () => {
  it.todo('only legal transitions are allowed; illegal throws');
  it.todo('every transition writes an event');
  it.todo('approved cannot go back to pending');
  it.todo('stale and expired are terminal until re-propose (superseded)');
  it.todo('needs_input goes awaiting_input -> answered and spawns a superseding attempt');
  it.todo('PR closed without merge moves applied -> closed_unmerged');
});

describe('decisions', () => {
  it.todo('FR-13: same idempotency key twice returns the same result');
  it.todo('FR-13: same key with a different payload is IDEMPOTENCY_KEY_REUSED');
  it.todo('FR-13: wrong expected_version returns VERSION_CONFLICT');
  it.todo('FR-13: approving a stale proposal fails with STALE_PROPOSAL');
  it.todo('approving after expires_at fails with PROPOSAL_EXPIRED (checked at decision time)');
  it.todo('two concurrent approvals: exactly one wins');
  it.todo('FR-24: an edited revision re-runs guard, verifier and risk');
});

describe('risk classifier', () => {
  it.todo('model-reported risk can raise but never lower');
  it.todo('generated text is never low risk');
  it.todo('oversized patch is high');
  it.todo('property: risk is monotonic as patch size grows');
});

describe('patch guard', () => {
  it.todo('allowed attribute passes');
  it.todo('script tag rejected');
  it.todo('event handler attribute rejected');
  it.todo('multi-file patch rejected unless the rule allows it');
  it.todo('patch not applying to base hash rejected');
  it.todo('invalid HTML rejected');
  it.todo('duplicate id rejected');
  it.todo('element removal or reorder rejected');
  it.todo('attribute value with markup, URL, control or bidi characters rejected');
});

describe('fingerprinting and dedupe', () => {
  it.todo('same violation on many pages yields one finding with many occurrences');
  it.todo('formatting-only differences do not change the fingerprint');
});

describe('mapper', () => {
  it.todo('FR-06: unique match maps');
  it.todo('FR-06: ambiguous match returns unmapped, never a guess');
});

describe('fixer loop', () => {
  it.todo('stops at max steps');
  it.todo('stops on submit_proposal');
  it.todo('invalid proposal returns errors to the model once, then fails');
  it.todo('tool timeout handled');
  it.todo('NFR-02: injection text in page does not alter allowed output');
});

describe('verifier', () => {
  it.todo('violation not reproducible locally is UNMAPPED_LOCAL_MISMATCH');
  it.todo('violation gone and no new ones: pass');
  it.todo('new violation: fail');
  it.todo('visual diff over threshold raises risk');
});

describe('exporter', () => {
  it.todo('FR-14: creates branch and PR once for repeated calls');
  it.todo('NFR-01: never targets the default branch (live lookup) or non beacon/* branches');
  it.todo('FR-15: revert creates a revert change');
  it.todo('FR-25: batch verified as a whole; one commit per proposal');
});

describe('review kit', () => {
  it.todo('keyboard shortcuts act on the focused proposal');
  it.todo('single-key shortcuts can be turned off (WCAG 2.1.4)');
  it.todo('bulk button disabled when any item is not low risk');
  it.todo('409 shows the someone-else-decided state');
});

describe('scanner safety', () => {
  it.todo('NFR-09: private, loopback, link-local and non-http schemes rejected');
  it.todo('NFR-09: redirect to private address rejected');
  it.todo('NFR-09: DNS rebinding blocked');
});
