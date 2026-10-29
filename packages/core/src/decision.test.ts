// Reviewer decisions: v1.0 §16.5 + addendum 1.4 (idempotency with request hash) and 1.6 (expiry
// checked at decision time). Edit-then-approve (FR-24) waits for the patch guard (Day 5).
import { describe, expect, it } from 'vitest';
import { decide, type DecidableProposal, type DecisionInput } from './decision.ts';
import { DomainError, type ErrorCode } from './errors.ts';
import type { Status } from './state-machine.ts';
import { catchError } from './test-helpers.ts';

const at = '2026-10-29T09:00:00Z';
const ctx = { userId: 'u1', at };

const proposal = (
  status: Status,
  overrides: Partial<DecidableProposal> = {},
): DecidableProposal => ({
  state: { id: 'p1', status, version: 3 },
  expires_at: '2026-11-05T08:00:00Z',
  decisions: [],
  ...overrides,
});

const approve = (key: string, expectedVersion = 3): DecisionInput => ({
  action: 'approve',
  key,
  expectedVersion,
});

const expectCode = (fn: () => unknown, code: ErrorCode) => {
  const error = catchError(fn);
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
};

describe('decide: approve', () => {
  it('moves pending -> approved, bumps version, writes one event and records the decision', () => {
    const result = decide(proposal('pending'), approve('k1'), ctx);
    expect(result.replayed).toBe(false);
    expect(result.state).toEqual({ id: 'p1', status: 'approved', version: 4 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      from_status: 'pending',
      to_status: 'approved',
      actor_type: 'user',
      actor_id: 'u1',
    });
    expect(result.decision).toMatchObject({
      proposal_id: 'p1',
      user_id: 'u1',
      action: 'approve',
      key: 'k1',
      expected_version: 3,
      decided_at: at,
    });
    expect(result.decision.request_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('FR-13: a retry with the same key and payload replays the first result with no new event', () => {
    const first = decide(proposal('pending'), approve('k1'), ctx);
    // The retry arrives after the first one landed: version is now 4, the request still says 3.
    const after = proposal('approved', { state: first.state, decisions: [first.decision] });
    const retry = decide(after, approve('k1'), { userId: 'u1', at: '2026-10-29T09:00:05Z' });
    expect(retry.replayed).toBe(true);
    expect(retry.events).toEqual([]);
    expect(retry.state).toEqual(first.state);
    expect(retry.decision).toEqual(first.decision);
  });

  it('FR-13: the same key with a different payload is IDEMPOTENCY_KEY_REUSED', () => {
    const first = decide(proposal('pending'), approve('k1'), ctx);
    const after = proposal('approved', { state: first.state, decisions: [first.decision] });
    expectCode(
      () => decide(after, { action: 'reject', key: 'k1', expectedVersion: 3 }, ctx),
      'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('FR-13: a wrong expectedVersion is VERSION_CONFLICT', () => {
    expectCode(() => decide(proposal('pending'), approve('k2', 2), ctx), 'VERSION_CONFLICT');
  });

  it('FR-13: approving a stale proposal is STALE_PROPOSAL', () => {
    expectCode(() => decide(proposal('stale'), approve('k3'), ctx), 'STALE_PROPOSAL');
  });

  it('a second reviewer deciding against the old version loses with VERSION_CONFLICT', () => {
    const first = decide(proposal('pending'), approve('alice'), ctx);
    const after = proposal('approved', { state: first.state, decisions: [first.decision] });
    expectCode(() => decide(after, approve('bob'), { userId: 'u2', at }), 'VERSION_CONFLICT');
  });

  it('at or after expires_at is PROPOSAL_EXPIRED even if the expiry sweep has not run', () => {
    const exp = '2026-10-29T09:00:00Z';
    expectCode(
      () => decide(proposal('pending', { expires_at: exp }), approve('k4'), ctx),
      'PROPOSAL_EXPIRED',
    );
    expectCode(() => decide(proposal('expired'), approve('k5'), ctx), 'PROPOSAL_EXPIRED');
  });

  it('one millisecond before expires_at is still decidable', () => {
    const result = decide(
      proposal('pending', { expires_at: '2026-10-29T09:00:00.001Z' }),
      approve('k6'),
      ctx,
    );
    expect(result.state.status).toBe('approved');
  });

  it('approving a needs_input proposal is ILLEGAL_TRANSITION', () => {
    expectCode(() => decide(proposal('awaiting_input'), approve('k7'), ctx), 'ILLEGAL_TRANSITION');
  });
});

describe('decide: reject', () => {
  it('moves pending -> rejected and keeps the optional reason on the event and decision', () => {
    const result = decide(
      proposal('pending'),
      { action: 'reject', key: 'k1', expectedVersion: 3, reason: 'alt text is wrong' },
      ctx,
    );
    expect(result.state.status).toBe('rejected');
    expect(result.events[0]?.reason).toBe('alt text is wrong');
    expect(result.decision.reason).toBe('alt text is wrong');
  });

  it('a reason changes the request hash, so it cannot be swapped under the same key', () => {
    const plain = decide(
      proposal('pending'),
      { action: 'reject', key: 'k', expectedVersion: 3 },
      ctx,
    );
    const withReason = decide(
      proposal('pending'),
      { action: 'reject', key: 'k', expectedVersion: 3, reason: 'x' },
      ctx,
    );
    expect(plain.decision.request_hash).not.toBe(withReason.decision.request_hash);
  });
});

describe('decide: answer', () => {
  it('moves awaiting_input -> answered and records the answer', () => {
    const result = decide(
      proposal('awaiting_input'),
      { action: 'answer', key: 'k1', expectedVersion: 3, answer: 'Decorative' },
      ctx,
    );
    expect(result.state.status).toBe('answered');
    expect(result.decision.answer).toBe('Decorative');
  });

  it('answering a patch proposal is ILLEGAL_TRANSITION', () => {
    expectCode(
      () =>
        decide(
          proposal('pending'),
          { action: 'answer', key: 'k2', expectedVersion: 3, answer: 'x' },
          ctx,
        ),
      'ILLEGAL_TRANSITION',
    );
  });
});

describe('decide: input is not mutated', () => {
  it('leaves the proposal record untouched', () => {
    const p = proposal('pending');
    const copy = structuredClone(p);
    decide(p, approve('k1'), ctx);
    expect(p).toEqual(copy);
  });
});
