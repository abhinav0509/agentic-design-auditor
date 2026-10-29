// Proposal state machine: v1.0 §8.3 as revised by addendum §1.3.
// The legal rows below are copied from the spec on purpose, not imported from the implementation,
// so the test checks the code against the document.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.ts';
import { initialStatus, STATUSES, TERMINAL, transition, type Status } from './state-machine.ts';
import { makeProposal } from './test-helpers.ts';

const SPEC_LEGAL: [Status, Status][] = [
  ['pending', 'approved'],
  ['pending', 'rejected'],
  ['pending', 'stale'],
  ['pending', 'expired'],
  ['pending', 'superseded'],
  ['awaiting_input', 'answered'],
  ['awaiting_input', 'stale'],
  ['awaiting_input', 'expired'],
  ['stale', 'superseded'],
  ['expired', 'superseded'],
  ['apply_failed', 'superseded'],
  ['approved', 'applied'],
  ['approved', 'apply_failed'],
  ['applied', 'merged'],
  ['applied', 'reverted'],
  ['applied', 'closed_unmerged'],
  ['closed_unmerged', 'applied'],
  ['merged', 'reverted'],
];
const SPEC_TERMINAL: Status[] = [
  'rejected',
  'declined',
  'superseded',
  'reverted',
  'blocked',
  'failed_verification',
  'answered',
];

const isLegal = (from: Status, to: Status) => SPEC_LEGAL.some(([f, t]) => f === from && t === to);
const legalFrom = (from: Status) => SPEC_LEGAL.filter(([f]) => f === from).map(([, t]) => t);

const at = '2026-10-29T08:00:00Z';
const reviewer = { type: 'user', id: 'u1' } as const;
const state = (status: Status) => ({ id: 'p1', status, version: 3 });

describe('transition table', () => {
  it.each(SPEC_LEGAL)('allows %s -> %s', (from, to) => {
    expect(transition(state(from), to, { actor: reviewer, at }).state.status).toBe(to);
  });

  it('rejects every other pair with ILLEGAL_TRANSITION (exhaustive)', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (isLegal(from, to)) continue;
        let error: unknown;
        try {
          transition(state(from), to, { actor: reviewer, at });
        } catch (e) {
          error = e;
        }
        expect(error, `${from} -> ${to}`).toBeInstanceOf(DomainError);
        expect((error as DomainError).code).toBe('ILLEGAL_TRANSITION');
      }
    }
  });

  it('terminal statuses match the spec and have no way out', () => {
    expect([...TERMINAL].sort()).toEqual([...SPEC_TERMINAL].sort());
    for (const from of SPEC_TERMINAL) expect(legalFrom(from)).toEqual([]);
  });

  it('stale, expired and apply_failed can only be superseded (re-propose)', () => {
    for (const from of ['stale', 'expired', 'apply_failed'] as const) {
      for (const to of STATUSES) {
        const legal = to === 'superseded';
        if (legal) continue;
        expect(() => transition(state(from), to, { actor: reviewer, at })).toThrow(DomainError);
      }
    }
  });
});

describe('transition', () => {
  it('returns the next state with version + 1 and exactly one event', () => {
    const result = transition(state('pending'), 'rejected', {
      actor: reviewer,
      reason: 'wrong alt text',
      at,
    });
    expect(result.state).toEqual({ id: 'p1', status: 'rejected', version: 4 });
    expect(result.event).toEqual({
      proposal_id: 'p1',
      from_status: 'pending',
      to_status: 'rejected',
      actor_type: 'user',
      actor_id: 'u1',
      reason: 'wrong alt text',
      created_at: at,
    });
  });

  it('records a null reason when none is given', () => {
    expect(
      transition(state('pending'), 'expired', { actor: { type: 'system', id: null }, at }).event
        .reason,
    ).toBeNull();
  });

  it('does not mutate the input state', () => {
    const before = state('pending');
    transition(before, 'approved', { actor: reviewer, at });
    expect(before).toEqual(state('pending'));
  });

  it('property: on any legal walk, approved never returns to pending and each step is one event', () => {
    const starts: Status[] = ['pending', 'awaiting_input'];
    fc.assert(
      fc.property(
        fc.constantFrom(...starts),
        fc.array(fc.nat(), { maxLength: 12 }),
        (start, choices) => {
          let current = state(start);
          let seenApproved = false;
          for (const choice of choices) {
            const options = legalFrom(current.status);
            if (options.length === 0) break;
            const to = options[choice % options.length] as Status;
            const { state: next, event } = transition(current, to, { actor: reviewer, at });
            expect(event.from_status).toBe(current.status);
            expect(event.to_status).toBe(to);
            expect(next.version).toBe(current.version + 1);
            if (to === 'approved') seenApproved = true;
            if (seenApproved) expect(next.status).not.toBe('pending');
            current = next;
          }
        },
      ),
    );
  });
});

describe('initialStatus (the "(new)" rows)', () => {
  const resolved = { violation_resolved: true, new_violations: 0, visual_diff_ratio: 0 };

  it('a patch that passed guard and verification is pending', () => {
    expect(initialStatus(makeProposal({ verification: resolved }), { guardPassed: true })).toBe(
      'pending',
    );
  });

  it('a patch that failed the guard is blocked, whatever verification says', () => {
    expect(initialStatus(makeProposal({ verification: resolved }), { guardPassed: false })).toBe(
      'blocked',
    );
  });

  it.each([
    { violation_resolved: false, new_violations: 0, visual_diff_ratio: 0 },
    { violation_resolved: true, new_violations: 1, visual_diff_ratio: 0 },
  ])('a patch with verification %j is failed_verification', (verification) => {
    expect(initialStatus(makeProposal({ verification }), { guardPassed: true })).toBe(
      'failed_verification',
    );
  });

  it('needs_input is awaiting_input', () => {
    const p = makeProposal({
      kind: 'needs_input',
      change: null,
      verification: null,
      question: { text: 'Decorative or informative?', options: ['Decorative', 'Informative'] },
    });
    expect(initialStatus(p, { guardPassed: true })).toBe('awaiting_input');
  });

  it('decline is declined', () => {
    const p = makeProposal({ kind: 'decline', change: null, verification: null, question: null });
    expect(initialStatus(p, { guardPassed: true })).toBe('declined');
  });

  it('every status is reachable from some initial status', () => {
    const initial: Status[] = [
      'pending',
      'blocked',
      'failed_verification',
      'awaiting_input',
      'declined',
    ];
    const seen = new Set<Status>(initial);
    const queue = [...initial];
    for (let s = queue.shift(); s; s = queue.shift()) {
      for (const to of legalFrom(s))
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
    }
    expect([...seen].sort()).toEqual([...STATUSES].sort());
  });
});
