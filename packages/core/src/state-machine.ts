// Proposal state machine: v1.0 §8.3 as revised by addendum §1.3 (and the Day 3 additions in D-016).
import { DomainError } from './errors.ts';
import type { Proposal } from './proposal.ts';

const NEXT = {
  pending: ['approved', 'rejected', 'stale', 'expired', 'superseded'],
  awaiting_input: ['answered', 'stale', 'expired'],
  approved: ['applied', 'apply_failed'],
  applied: ['merged', 'reverted', 'closed_unmerged'],
  closed_unmerged: ['applied'],
  merged: ['reverted'],
  stale: ['superseded'],
  expired: ['superseded'],
  apply_failed: ['superseded'],
  rejected: [],
  declined: [],
  superseded: [],
  reverted: [],
  blocked: [],
  failed_verification: [],
  answered: [],
} as const satisfies Record<string, readonly string[]>;

export type Status = keyof typeof NEXT;
export const STATUSES = Object.keys(NEXT) as Status[];
export const TERMINAL: ReadonlySet<Status> = new Set(STATUSES.filter((s) => NEXT[s].length === 0));

export type ProposalState = { id: string; status: Status; version: number };
export type Actor = { type: 'system' | 'agent' | 'user'; id: string | null };

/** One row of proposal_events. */
export type ProposalEvent = {
  proposal_id: string;
  from_status: Status;
  to_status: Status;
  actor_type: Actor['type'];
  actor_id: string | null;
  reason: string | null;
  created_at: string;
};

export function transition(
  current: ProposalState,
  to: Status,
  ctx: { actor: Actor; at: string; reason?: string },
): { state: ProposalState; event: ProposalEvent } {
  if (!(NEXT[current.status] as readonly Status[]).includes(to)) {
    throw new DomainError('ILLEGAL_TRANSITION', `illegal transition ${current.status} -> ${to}`);
  }
  return {
    state: { ...current, status: to, version: current.version + 1 },
    event: {
      proposal_id: current.id,
      from_status: current.status,
      to_status: to,
      actor_type: ctx.actor.type,
      actor_id: ctx.actor.id,
      reason: ctx.reason ?? null,
      created_at: ctx.at,
    },
  };
}

/** Status of a freshly produced proposal: the "(new)" rows of the table. */
export function initialStatus(p: Proposal, checks: { guardPassed: boolean }): Status {
  switch (p.kind) {
    case 'decline':
      return 'declined';
    case 'needs_input':
      return 'awaiting_input';
    case 'patch': {
      if (!checks.guardPassed) return 'blocked';
      const v = p.verification;
      return v.violation_resolved && v.new_violations === 0 ? 'pending' : 'failed_verification';
    }
  }
}
