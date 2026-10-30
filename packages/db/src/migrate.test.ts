// Forward-only migrations (addendum D.3).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { migrate } from './migrate.ts';
import { createTestDb, type TestDb } from './test-db.ts';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb('migrate');
});

afterAll(async () => {
  await db.drop();
});

it('records each applied migration once, and a second run applies nothing', async () => {
  const rows = await db.sql<{ name: string }[]>`select name from schema_migrations order by name`;
  expect(rows.map((r) => r.name)).toContain('0001_init.sql');
  expect(await migrate(db.sql)).toEqual([]);
});

it('two migrators racing apply each migration once', async () => {
  const runs = await Promise.all([migrate(db.sql), migrate(db.sql)]);
  expect(runs.flat()).toEqual([]);
  const [r] = await db.sql<{ n: number }[]>`
    select count(*)::int as n from schema_migrations where name = '0001_init.sql'`;
  expect(r?.n).toBe(1);
});
