// Forward-only SQL migrations (addendum D.3). Pending files run in name order, all in one
// transaction under an advisory lock, so racing migrators apply each file once.
import { readdir, readFile } from 'node:fs/promises';
import type { Sql } from 'postgres';

const DIR = new URL('../migrations/', import.meta.url);
const LOCK_KEY = 0x6265_6163; // 'beac'

/** Applies pending migrations and returns their names. */
export async function migrate(sql: Sql): Promise<string[]> {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  const bodies = await Promise.all(files.map((f) => readFile(new URL(f, DIR), 'utf8')));
  return sql.begin<string[]>(async (tx) => {
    await tx.unsafe('select pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await tx.unsafe(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set(
      (await tx.unsafe<{ name: string }[]>('select name from schema_migrations')).map(
        (r) => r.name,
      ),
    );
    const applied: string[] = [];
    for (const [i, name] of files.entries()) {
      if (done.has(name)) continue;
      await tx.unsafe(bodies[i] ?? '');
      await tx.unsafe('insert into schema_migrations (name) values ($1)', [name]);
      applied.push(name);
    }
    return applied;
  });
}
