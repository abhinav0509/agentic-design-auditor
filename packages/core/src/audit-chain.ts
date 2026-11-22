export type AuditEvent = {
  id: number;
  proposalId: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: string;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
  canonical: string;
  prevHash: string | null;
  hash: string;
};
export function verifyAuditChain(
  _e: AuditEvent[],
): { ok: true; events: number } | { ok: false; at: number; reason: string } {
  return { ok: false, at: -1, reason: 'not implemented' };
}
