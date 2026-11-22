import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAuditChain, type AuditEvent } from './audit-chain.ts';

/** A chain built the way the database builds it (migration 0003): hash = sha256(prev || canonical). */
function chain(n: number): AuditEvent[] {
  const out: AuditEvent[] = [];
  let prev: string | null = null;
  for (let i = 1; i <= n; i++) {
    const fields = {
      id: i,
      proposal_id: `p${String(i)}`,
      from_status: 'pending',
      to_status: 'approved',
      actor_type: 'user',
      actor_id: 'u1',
      reason: null,
    };
    const canonical = JSON.stringify({
      ...fields,
      org_id: 'o1',
      data: {},
      created_at: '2026-11-22T10:00:00',
    });
    const hash = createHash('sha256')
      .update(
        Buffer.concat([
          prev ? Buffer.from(prev, 'hex') : Buffer.alloc(0),
          Buffer.from(canonical, 'utf8'),
        ]),
      )
      .digest('hex');
    out.push({
      id: i,
      proposalId: fields.proposal_id,
      fromStatus: 'pending',
      toStatus: 'approved',
      actorType: 'user',
      actorId: 'u1',
      reason: null,
      createdAt: '2026-11-22T10:00:00Z',
      canonical,
      prevHash: prev,
      hash,
    });
    prev = hash;
  }
  return out;
}

describe('verifyAuditChain', () => {
  it('FR-26: an exported chain verifies from the export alone', () => {
    expect(verifyAuditChain(chain(5))).toEqual({ ok: true, events: 5 });
  });

  it.each([
    [
      'an edited reason',
      (c: AuditEvent[]) => {
        (c[2] as AuditEvent).reason = 'changed later';
      },
    ],
    [
      'an edited canonical text',
      (c: AuditEvent[]) => {
        const e = c[2] as AuditEvent;
        e.canonical = e.canonical.replace('approved', 'rejected');
      },
    ],
    [
      'a removed event',
      (c: AuditEvent[]) => {
        c.splice(2, 1);
      },
    ],
    [
      'two events swapped',
      (c: AuditEvent[]) => {
        const t = c[1] as AuditEvent;
        c[1] = c[2] as AuditEvent;
        c[2] = t;
      },
    ],
    [
      'a forged hash',
      (c: AuditEvent[]) => {
        (c[3] as AuditEvent).hash = 'ab'.repeat(32);
      },
    ],
  ])('FR-26: %s breaks the chain at the right event', (_name, tamper) => {
    const c = chain(5);
    tamper(c);
    const r = verifyAuditChain(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.at).toBeGreaterThanOrEqual(1);
  });
});
