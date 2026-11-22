// The org kill switch (FR-28, D-057): one setting pauses all agent activity for an org at once.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { agentPaused, setAgentPaused } from './kill-switch.ts';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG = '00000000-0000-4000-8000-0000000000e2';
const OTHER = '00000000-0000-4000-8000-0000000000e3';
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb('kill_switch');
  await seedOrg(db.sql, ORG);
  await seedOrg(db.sql, OTHER);
});
afterAll(async () => {
  await db.drop();
});

it('FR-28: pausing an org pauses only that org, and resuming lifts it', async () => {
  const at = new Date('2026-11-22T12:00:00Z');
  expect(await asApp(db.sql, ORG, (tx) => agentPaused(tx))).toBe(false);

  await asApp(db.sql, ORG, (tx) =>
    setAgentPaused(tx, { paused: true, at, reason: 'Investigating a bad fix' }),
  );

  expect(await asApp(db.sql, ORG, (tx) => agentPaused(tx))).toBe(true);
  expect(await asApp(db.sql, OTHER, (tx) => agentPaused(tx))).toBe(false);
  const [row] = await db.sql`select agent_paused_reason from organizations where id = ${ORG}`;
  expect(row).toEqual({ agent_paused_reason: 'Investigating a bad fix' });

  await asApp(db.sql, ORG, (tx) => setAgentPaused(tx, { paused: false, at }));
  expect(await asApp(db.sql, ORG, (tx) => agentPaused(tx))).toBe(false);
});

it('FR-28: an org cannot pause or resume another org', async () => {
  await asApp(db.sql, OTHER, (tx) => setAgentPaused(tx, { paused: true, at: new Date() }));
  await asApp(
    db.sql,
    ORG,
    (tx) => tx`update organizations set agent_paused_at = null where id = ${OTHER}`,
  );

  expect(await asApp(db.sql, OTHER, (tx) => agentPaused(tx))).toBe(true);
});
