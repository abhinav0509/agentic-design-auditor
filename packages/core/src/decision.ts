// Reviewer decisions: v1.0 §16.5 + addendum 1.4 / 1.6. Pure: the caller loads this proposal's
// earlier decisions and persists the result; concurrent writers are settled by the DB version check.
import { createHash } from 'node:crypto';
import { DomainError } from './errors.ts';
import {
  transition,
  type ProposalEvent,
  type ProposalState,
  type Status,
} from './state-machine.ts';

export type DecisionInput =
  | { action: 'approve'; key: string; expectedVersion: number }
  | { action: 'reject'; key: string; expectedVersion: number; reason?: string }
  | { action: 'answer'; key: string; expectedVersion: number; answer: string };

/** One row of the decisions table. */
export type RecordedDecision = {
  proposal_id: string;
  user_id: string;
  action: DecisionInput['action'];
  key: string;
  request_hash: string;
  expected_version: number;
  reason: string | null;
  answer: string | null;
  decided_at: string;
};

export type DecidableProposal = {
  state: ProposalState;
  expires_at: string;
  decisions: readonly RecordedDecision[];
};

export type DecisionResult = {
  state: ProposalState;
  events: ProposalEvent[];
  decision: RecordedDecision;
  replayed: boolean;
};

const TARGET: Record<DecisionInput['action'], Status> = {
  approve: 'approved',
  reject: 'rejected',
  answer: 'answered',
};

export function decide(
  p: DecidableProposal,
  input: DecisionInput,
  ctx: { userId: string; at: string },
): DecisionResult {
  const reason = input.action === 'reject' ? (input.reason ?? null) : null;
  const answer = input.action === 'answer' ? input.answer : null;
  const request_hash = createHash('sha256')
    .update(JSON.stringify([input.action, input.expectedVersion, reason, answer]))
    .digest('hex');

  // Idempotency first, so a retry after success replays instead of reporting a conflict.
  const prior = p.decisions.find((d) => d.key === input.key);
  if (prior) {
    if (prior.request_hash !== request_hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED');
    return { state: p.state, events: [], decision: prior, replayed: true };
  }

  const { status, version } = p.state;
  const undecided = status === 'pending' || status === 'awaiting_input';
  if (status === 'expired' || (undecided && Date.parse(ctx.at) >= Date.parse(p.expires_at))) {
    throw new DomainError('PROPOSAL_EXPIRED');
  }
  if (status === 'stale') throw new DomainError('STALE_PROPOSAL');
  if (version !== input.expectedVersion) {
    throw new DomainError(
      'VERSION_CONFLICT',
      `expected version ${String(input.expectedVersion)}, found ${String(version)}`,
    );
  }

  const { state, event } = transition(p.state, TARGET[input.action], {
    actor: { type: 'user', id: ctx.userId },
    at: ctx.at,
    ...(reason === null ? {} : { reason }),
  });
  return {
    state,
    events: [event],
    decision: {
      proposal_id: p.state.id,
      user_id: ctx.userId,
      action: input.action,
      key: input.key,
      request_hash,
      expected_version: input.expectedVersion,
      reason,
      answer,
      decided_at: ctx.at,
    },
    replayed: false,
  };
}
