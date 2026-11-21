// Operator fix run: argument checks (FR-14, D-054). The site is the repo's GitHub Pages project site,
// https://<owner>.github.io/<repo>/, which the repo itself serves: a token that can push to the repo
// controls the site (the CLI checks the push access). Pages are paths inside that site, at most 10.
import { orgIdFor } from './plan.ts';

export type FixPlan = {
  owner: string;
  repo: string;
  siteUrl: string;
  urls: string[];
  orgId: string;
  requestedBy: string;
  agentReview?: true;
};

const USAGE = 'usage: pnpm fix scan [--agent-review] --repo <owner/repo> [page path ...]';
const REPO = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/;
const PAGE = /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*)?$/;
const MAX_PAGES = 10;

export function planFixRun(
  argv: string[],
): { ok: true; plan: FixPlan } | { ok: false; error: string } {
  const agentReview = argv.includes('--agent-review');
  const args = argv.filter((a) => a !== '--agent-review');
  if (args.length === 0) return { ok: false, error: USAGE };
  const at = args.indexOf('--repo');
  const full = at === -1 ? undefined : args[at + 1];
  const m = full === undefined ? null : REPO.exec(full);
  if (!m || full?.includes('..'))
    return { ok: false, error: `--repo must be owner/repo. ${USAGE}` };
  const [, owner = '', repo = ''] = m;
  const paths = args.filter((_, i) => i !== at && i !== at + 1);
  if (paths.length > MAX_PAGES)
    return { ok: false, error: `a run covers at most ${String(MAX_PAGES)} pages` };
  for (const p of paths)
    if (!PAGE.test(p) || p.includes('..'))
      return { ok: false, error: `not a page path inside the site: ${p}` };
  const siteUrl = `https://${owner.toLowerCase()}.github.io/${repo}/`;
  return {
    ok: true,
    plan: {
      owner,
      repo,
      siteUrl,
      urls: (paths.length ? paths : ['']).map((p) => `${siteUrl}${p}`),
      orgId: orgIdFor(`github:${owner.toLowerCase()}/${repo.toLowerCase()}`),
      requestedBy: `github:${owner}/${repo}`,
      ...(agentReview ? { agentReview: true as const } : {}),
    },
  };
}
