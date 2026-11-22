// pnpm audit:verify <audit.json> (FR-26, D-059): checks an exported audit log on its own: every link,
// every hash, and the readable fields against what was hashed. Exits 1 at the first broken event.
import { verifyAuditChain, type AuditEvent } from '@beacon/core';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: pnpm audit:verify <audit.json>');
  process.exit(2);
}
const log = JSON.parse(readFileSync(file, 'utf8')) as { orgId: string; events: AuditEvent[] };
const check = verifyAuditChain(log.events);
if (check.ok) {
  console.log(
    `Verified: ${String(check.events)} events for organisation ${log.orgId}, an unbroken chain.`,
  );
} else {
  const e = log.events[check.at];
  console.error(
    `Broken at event ${String(check.at + 1)} (id ${String(e?.id ?? '?')}): ${check.reason}.`,
  );
  process.exit(1);
}
