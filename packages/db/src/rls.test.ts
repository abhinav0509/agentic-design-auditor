// Tenant isolation (addendum 2.5, D.1): every tenant table carries org_id under forced RLS, and the
// app role can neither read nor write another org's rows. Tables are read from the catalog, so a new
// table without isolation fails here instead of shipping.
import { STATUSES } from '@beacon/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asApp, createTestDb, seedOrg, type TestDb } from './test-db.ts';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';

/** Tables without org_id, each reviewed: isolated by their own policy, or not reachable by the app. */
const GLOBAL_TABLES = ['organizations', 'schema_migrations', 'users'];

let db: TestDb;
let seedB: Record<string, string>;
let orgTables: string[];

const pgCode = async (p: Promise<unknown>): Promise<string | undefined> =>
  p.then(
    () => undefined,
    (e: unknown) => (e as { code?: string }).code,
  );

beforeAll(async () => {
  db = await createTestDb('rls');
  await seedOrg(db.sql, ORG_A);
  seedB = await seedOrg(db.sql, ORG_B);
  orgTables = (
    await db.sql<{ table_name: string }[]>`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'org_id' order by 1`
  ).map((r) => r.table_name);
});

afterAll(async () => {
  await db.drop();
});

describe('catalog', () => {
  it('NFR-16: every public table carries org_id or is on the reviewed global list', async () => {
    const all = await db.sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' order by 1`;
    const unreviewed = all
      .map((r) => r.tablename)
      .filter((t) => !orgTables.includes(t) && !GLOBAL_TABLES.includes(t));
    expect(unreviewed).toEqual([]);
    expect(orgTables.length).toBeGreaterThanOrEqual(14);
  });

  it('NFR-16: RLS is enabled and forced on every table the app can reach', async () => {
    const rows = await db.sql<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations'
        and not (c.relrowsecurity and c.relforcerowsecurity)`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('NFR-16: the app role is not a superuser, owns nothing and cannot bypass RLS', async () => {
    const [role] = await db.sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = 'beacon_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await db.sql`
      select 1 from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'beacon_app'`;
    expect(owned).toHaveLength(0);
  });

  it('NFR-16: the app role cannot touch schema_migrations', async () => {
    expect(await pgCode(asApp(db.sql, ORG_A, (tx) => tx`select * from schema_migrations`))).toBe(
      '42501',
    );
  });

  it('NFR-16: every foreign key between tenant tables includes org_id', async () => {
    // RLS is not applied to FK checks, so without org_id in the key, org A could attach rows to org
    // B's parents by id.
    const rows = await db.sql<{ conname: string }[]>`
      select c.conname from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_class parent on parent.oid = c.confrelid
      where c.contype = 'f'
        and child.relname = any(${orgTables}) and parent.relname = any(${orgTables})
        and not exists (
          select 1 from pg_attribute a
          where a.attrelid = c.conrelid and a.attname = 'org_id' and a.attnum = any(c.conkey))
      order by 1`;
    expect(rows.map((r) => r.conname)).toEqual([]);
  });
});

describe('cross-tenant matrix', () => {
  it('NFR-16: the seed puts rows for both orgs in every tenant table', async () => {
    const empty: string[] = [];
    for (const t of orgTables) {
      const [row] = await db.sql<{ a: number; b: number }[]>`
        select count(*) filter (where org_id = ${ORG_A})::int as a,
               count(*) filter (where org_id = ${ORG_B})::int as b
        from ${db.sql(t)}`;
      if (!row || row.a === 0 || row.b === 0) empty.push(t);
    }
    expect(empty).toEqual([]);
  });

  it("NFR-16: cross-tenant reads return 0 rows and own reads return the org's rows", async () => {
    const leaks: string[] = [];
    for (const t of orgTables) {
      const [own] = await db.sql<{ n: number }[]>`
        select count(*)::int as n from ${db.sql(t)} where org_id = ${ORG_A}`;
      const [seen] = await asApp(
        db.sql,
        ORG_A,
        (tx) => tx<{ total: number; other: number }[]>`
          select count(*)::int as total,
                 count(*) filter (where org_id <> ${ORG_A})::int as other
          from ${tx(t)}`,
      );
      if (seen?.other !== 0 || seen.total !== own?.n) leaks.push(`${t}: ${JSON.stringify(seen)}`);
    }
    expect(leaks).toEqual([]);
  });

  it('NFR-16: cross-tenant updates and deletes touch 0 rows', async () => {
    const touched: string[] = [];
    for (const t of orgTables) {
      const n = await asApp(db.sql, ORG_A, async (tx) => {
        const u = await tx`update ${tx(t)} set org_id = org_id where org_id = ${ORG_B}`;
        const d = await tx`delete from ${tx(t)} where org_id = ${ORG_B}`;
        return u.count + d.count;
      }).catch(() => 0); // a permission error on an append-only table also touches nothing
      if (n !== 0) touched.push(t);
    }
    expect(touched).toEqual([]);
  });

  it('NFR-16: inserting a row into another org is refused by the policy', async () => {
    const accepted: string[] = [];
    for (const t of orgTables) {
      const [row] = await db.sql<{ j: unknown }[]>`
        select to_jsonb(x) as j from ${db.sql(t)} x where org_id = ${ORG_B} limit 1`;
      const code = await pgCode(
        asApp(
          db.sql,
          ORG_A,
          (tx) => tx`
            insert into ${tx(t)} overriding system value
            select (jsonb_populate_record(null::${tx(t)}, ${tx.json(row?.j as never)})).*`,
        ),
      );
      if (code !== '42501') accepted.push(`${t}: ${String(code)}`);
    }
    expect(accepted).toEqual([]);
  });

  it("NFR-16: own-org rows cannot reference another org's parent by id", async () => {
    const code = await pgCode(
      asApp(
        db.sql,
        ORG_A,
        (tx) =>
          tx`insert into pages (org_id, run_id, url) values (${ORG_A}, ${seedB.run ?? ''}, 'x')`,
      ),
    );
    expect(code).toBe('23503');
  });

  it('NFR-16: organizations and users are visible only through own membership', async () => {
    const seen = await asApp(db.sql, ORG_A, async (tx) => ({
      orgs: (await tx<{ id: string }[]>`select id from organizations`).map((r) => r.id),
      users: (await tx<{ id: string }[]>`select id from users`).map((r) => r.id),
    }));
    expect(seen.orgs).toEqual([ORG_A]);
    expect(seen.users).toHaveLength(1);
    expect(seen.users).not.toContain(seedB.user);
  });
});

describe('fails closed', () => {
  it('NFR-16: with app.org_id unset, every tenant table reads 0 rows', async () => {
    const visible = await asApp(db.sql, null, async (tx) => {
      const out: string[] = [];
      for (const t of [...orgTables, 'organizations', 'users']) {
        const [r] = await tx<{ n: number }[]>`select count(*)::int as n from ${tx(t)}`;
        if (r?.n !== 0) out.push(t);
      }
      return out;
    });
    expect(visible).toEqual([]);
  });

  it('NFR-16: a pooled connection whose previous transaction set app.org_id reads 0 rows', async () => {
    const conn = await db.sql.reserve();
    try {
      await asApp(conn, ORG_A, () => Promise.resolve());
      // set_config(..., true) left '' behind for the session; the policy must treat it as unset.
      const [r] = await asApp(
        conn,
        null,
        (tx) => tx<{ n: number }[]>`select count(*)::int as n from sites`,
      );
      expect(r?.n).toBe(0);
    } finally {
      conn.release();
    }
  });
});

describe('append-only history (v1.0 §10.2, addendum D.1)', () => {
  for (const t of ['proposal_events', 'decisions', 'usage_ledger']) {
    it(`FR-16: ${t} rejects update, delete and truncate, even for the owner`, async () => {
      const tbl = db.sql(t);
      const attempts = [
        db.sql`update ${tbl} set org_id = org_id`,
        db.sql`delete from ${tbl}`,
        db.sql`truncate ${tbl}`,
      ];
      for (const a of attempts) await expect(a).rejects.toThrow(/append-only/);
    });
  }
});

describe('contract with core', () => {
  it('proposals.status accepts exactly the core state machine statuses', async () => {
    const tryStatus = (status: string) =>
      pgCode(
        db.sql.begin(async (tx) => {
          await tx`update proposals set status = ${status} where org_id = ${ORG_A}`;
          throw Object.assign(new Error('rollback'), { code: 'ok' });
        }),
      );
    for (const s of STATUSES) expect(await tryStatus(s), s).toBe('ok');
    expect(await tryStatus('bogus')).toBe('23514');
  });

  it('a patch proposal needs a risk level; needs_input and decline may omit it', async () => {
    const tryKind = (kind: string) =>
      pgCode(
        db.sql.begin(async (tx) => {
          await tx`update proposals set kind = ${kind}, risk_level = null where org_id = ${ORG_A}`;
          throw Object.assign(new Error('rollback'), { code: 'ok' });
        }),
      );
    expect(await tryKind('patch')).toBe('23514');
    expect(await tryKind('needs_input')).toBe('ok');
    expect(await tryKind('decline')).toBe('ok');
  });
});
