// Verifying an exported audit log (FR-26, NFR-10, addendum 2.8, D-059). The database chains each
// org's proposal events (D-036): hash = sha256(prev_hash || utf8(canonical)), where canonical is the
// event's JSON exactly as Postgres hashed it. An export carries that text, so anyone can check the
// chain with SHA-256 alone: every link, every hash, and that the readable fields say the same thing.
import { createHash } from 'node:crypto';

export type AuditEvent = {
  id: number;
  proposalId: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
  /** The event's JSON exactly as the database hashed it. */
  canonical: string;
  prevHash: string | null;
  hash: string;
};

export type ChainCheck = { ok: true; events: number } | { ok: false; at: number; reason: string };

export function verifyAuditChain(events: AuditEvent[]): ChainCheck {
  let prev: string | null = null;
  for (const [at, e] of events.entries()) {
    if (e.prevHash !== prev)
      return { ok: false, at, reason: 'does not link to the event before it' };
    const hash: string = createHash('sha256')
      .update(
        Buffer.concat([
          prev ? Buffer.from(prev, 'hex') : Buffer.alloc(0),
          Buffer.from(e.canonical, 'utf8'),
        ]),
      )
      .digest('hex');
    if (hash !== e.hash) return { ok: false, at, reason: 'its hash does not match its content' };
    let c: Record<string, unknown>;
    try {
      c = JSON.parse(e.canonical) as Record<string, unknown>;
    } catch {
      return { ok: false, at, reason: 'its canonical text is not JSON' };
    }
    const same =
      c['id'] === e.id &&
      c['proposal_id'] === e.proposalId &&
      c['from_status'] === e.fromStatus &&
      c['to_status'] === e.toStatus &&
      c['actor_type'] === e.actorType &&
      c['actor_id'] === e.actorId &&
      c['reason'] === e.reason;
    if (!same) return { ok: false, at, reason: 'its readable fields differ from what was hashed' };
    prev = e.hash;
  }
  return { ok: true, events: events.length };
}
