// Sites and their ownership proof (FR-03, FR-04, FR-04a, addendum 2.1, D-060). Callers pass a
// transaction that runs as the app role with app.org_id set. One token per site until it is proven;
// a proof stays fresh for 30 days, then the site proves it again before the next scan.
import type { TransactionSql } from 'postgres';

const FRESH_DAYS = 30;

/** The org's site for a base URL, created on first use. */
export async function registerSite(
  tx: TransactionSql,
  { orgId, baseUrl }: { orgId: string; baseUrl: string },
): Promise<string> {
  const [found] = await tx<{ id: string }[]>`
    select id from sites where base_url = ${baseUrl} and deleted_at is null limit 1`;
  if (found) return found.id;
  const [created] = await tx<{ id: string }[]>`
    insert into sites (org_id, base_url) values (${orgId}, ${baseUrl}) returning id`;
  if (!created) throw new Error('site not created');
  return created.id;
}

/** The site's token: the one it already has, or `token` when it has none. */
export async function issueOwnershipToken(
  tx: TransactionSql,
  { siteId, token }: { siteId: string; token: string },
): Promise<string> {
  const [row] = await tx<{ ownership_token: string }[]>`
    update sites set ownership_token = coalesce(ownership_token, ${token})
    where id = ${siteId} returning ownership_token`;
  if (!row) throw new Error(`no site ${siteId}`);
  return row.ownership_token;
}

export async function recordOwnershipProof(
  tx: TransactionSql,
  { siteId, at }: { siteId: string; at: Date },
): Promise<void> {
  await tx`update sites set ownership_verified_at = ${at} where id = ${siteId}`;
}

/** Whether the site proved control within the last 30 days. */
export async function ownershipFresh(
  tx: TransactionSql,
  { siteId, now }: { siteId: string; now: Date },
): Promise<boolean> {
  const since = new Date(now.getTime() - FRESH_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await tx<{ fresh: boolean }[]>`
    select coalesce(ownership_verified_at > ${since}, false) as fresh from sites where id = ${siteId}`;
  return row?.fresh ?? false;
}
