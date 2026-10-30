// Test harness: a throwaway database per test file, plus the app-role session production uses.
// Not imported by production code.
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { migrate } from './migrate.ts';

const ADMIN_URL = process.env['BEACON_TEST_DATABASE_URL'] ?? 'postgres://localhost/postgres';

export type TestDb = { sql: Sql; url: string; drop: () => Promise<void> };

/** Creates beacon_test_<tag>_<pid>, migrated. The admin URL must be a superuser (CI service / local). */
export async function createTestDb(tag: string): Promise<TestDb> {
  if (!/^[a-z_]+$/.test(tag)) throw new Error(`bad test db tag: ${tag}`);
  const name = `beacon_test_${tag}_${String(process.pid)}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`drop database if exists ${name} with (force)`);
  await admin.unsafe(`create database ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const sql = postgres(url.href, { onnotice: () => undefined });
  await migrate(sql);
  return {
    sql,
    url: url.href,
    drop: async () => {
      await sql.end();
      await admin.unsafe(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}

/** Runs fn in a transaction as beacon_app with app.org_id set (or unset when org is null). */
export function asApp<T>(
  sql: Sql,
  org: string | null,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe('set local role beacon_app');
    if (org) await tx.unsafe(`select set_config('app.org_id', $1, true)`, [org]);
    return fn(tx);
  }) as Promise<T>;
}

/** One row in every tenant table for this org, chained through real foreign keys. */
export async function seedOrg(sql: Sql, org: string): Promise<Record<string, string>> {
  const one = async (q: string, params: (string | number)[]): Promise<string> => {
    const rows = await sql.unsafe<{ id: string }[]>(q, params);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`seed returned no id: ${q}`);
    return id;
  };
  await sql.unsafe(`insert into organizations (id, name) values ($1, $2)`, [org, org]);
  const user = await one(`insert into users (email) values ($1 || '@example.test') returning id`, [
    org,
  ]);
  await sql.unsafe(`insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [
    org,
    user,
  ]);
  const site = await one(
    `insert into sites (org_id, base_url) values ($1, 'https://example.test') returning id`,
    [org],
  );
  await sql.unsafe(
    `insert into site_connections (org_id, site_id, installation_ref, repo_full_name, default_branch)
     values ($1, $2, 'inst-1', 'acme/site', 'main')`,
    [org, site],
  );
  const run = await one(
    `insert into scan_runs (org_id, site_id, status, base_commit_sha, agent_version, prompt_version,
       model_name, budget, engine_version)
     values ($1, $2, 'queued', 'abc', 'a1', 'p1', 'm1', '{}', 'axe-4.14.0') returning id`,
    [org, site],
  );
  const page = await one(
    `insert into pages (org_id, run_id, url) values ($1, $2, 'https://example.test/') returning id`,
    [org, run],
  );
  const finding = await one(
    `insert into findings (org_id, run_id, page_id, fingerprint, rule_id, impact, selector, html_snippet)
     values ($1, $2, $3, 'fp', 'image-alt', 'critical', 'img', '<img>') returning id`,
    [org, run, page],
  );
  const proposal = await one(
    `insert into proposals (org_id, run_id, finding_id, kind, status, schema_version, payload,
       risk_level, base_commit_sha, base_content_hash, target_file_hash, expires_at)
     values ($1, $2, $3, 'patch', 'pending', '1', '{}', 'low', 'abc', 'h', 'h', now() + interval '7 days')
     returning id`,
    [org, run, finding],
  );
  await sql.unsafe(
    `insert into proposal_events (org_id, proposal_id, to_status, actor_type, hash)
     values ($1, $2, 'pending', 'agent', '\\x00')`,
    [org, proposal],
  );
  await sql.unsafe(
    `insert into decisions (org_id, proposal_id, user_id, action, idempotency_key, expected_version,
       request_hash)
     values ($1, $2, $3, 'approve', 'k1', 1, '\\x00')`,
    [org, proposal, user],
  );
  await sql.unsafe(
    `insert into exports (org_id, site_id, kind, branch, proposal_ids, status)
     values ($1, $2, 'pull_request', 'beacon/r1/b1', array[$3::uuid], 'pending')`,
    [org, site, proposal],
  );
  await sql.unsafe(`insert into llm_calls (org_id, run_id, proposal_id) values ($1, $2, $3)`, [
    org,
    run,
    proposal,
  ]);
  await sql.unsafe(
    `insert into agent_traces (org_id, run_id, finding_id, step, tool) values ($1, $2, $3, 1, 'read_file')`,
    [org, run, finding],
  );
  await sql.unsafe(
    `insert into usage_ledger (org_id, run_id, kind, units, cost_micros) values ($1, $2, 'model', 1, 1)`,
    [org, run],
  );
  await sql.unsafe(
    `insert into outbox (org_id, topic, payload, dedupe_key) values ($1, 'export', '{}', 'k1')`,
    [org],
  );
  return { user, site, run, page, finding, proposal };
}
