// Operator report: argument checks (FR-30, D-045). The requester's work email must be on the site's
// own domain (D-043), all pages on one host, at most 10 (FR-05).
import { emailProvesSite } from '@beacon/core';
import { createHash } from 'node:crypto';

export type ReportPlan = {
  requestedBy: string;
  siteUrl: string;
  urls: string[];
  orgId: string;
  /** Present, and true, only when --agent-review asks for the agent review (D-048). */
  agentReview?: true;
  /** Present, and true, only when --preview-fixes asks for fix previews (D-056). */
  previewFixes?: true;
  /** Present, and true, when the site's own proof (FR-04a) stands in for the email rule (D-060). */
  siteProven?: true;
};

const USAGE =
  'usage: pnpm report [--agent-review] [--preview-fixes] [--site-proven] --requested-by <email> <url> [url ...]';
const MAX_PAGES = 10;

/** One org per site host, derived so a re-run for the same site reuses its org and history. */
export function orgIdFor(host: string): string {
  const h = createHash('sha256').update(`beacon-report-org:${host}`).digest('hex');
  const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function planReport(
  argv: string[],
): { ok: true; plan: ReportPlan } | { ok: false; error: string } {
  const agentReview = argv.includes('--agent-review');
  const previewFixes = argv.includes('--preview-fixes');
  const siteProven = argv.includes('--site-proven');
  argv = argv.filter(
    (a) => a !== '--agent-review' && a !== '--preview-fixes' && a !== '--site-proven',
  );
  if (argv.length === 0) return { ok: false, error: USAGE };
  const at = argv.indexOf('--requested-by');
  const requestedBy = at === -1 ? undefined : argv[at + 1];
  if (requestedBy === undefined)
    return { ok: false, error: `--requested-by is required. ${USAGE}` };
  const urls = argv.filter((_, i) => i !== at && i !== at + 1);
  const first = urls[0];
  if (first === undefined) return { ok: false, error: `give at least one URL. ${USAGE}` };
  if (urls.length > MAX_PAGES)
    return { ok: false, error: `a report covers at most ${String(MAX_PAGES)} pages` };

  const hosts = new Set<string>();
  for (const u of urls) {
    try {
      hosts.add(new URL(u).host);
    } catch {
      return { ok: false, error: `not a URL: ${u}` };
    }
  }
  if (hosts.size !== 1) return { ok: false, error: 'all URLs must be on the same host' };

  // FR-04: either the requester's work email proves the site (FR-30), or the site proved control
  // itself (FR-04a), which the CLI checks against the database before scanning.
  const proof = siteProven ? { ok: true as const } : emailProvesSite(requestedBy, first);
  if (!proof.ok)
    return { ok: false, error: `${requestedBy} does not prove ${first}: ${proof.reason}` };
  const site = new URL(first);
  return {
    ok: true,
    plan: {
      requestedBy,
      siteUrl: `${site.protocol}//${site.host}/`,
      urls,
      orgId: orgIdFor(site.host.replace(/^www\./, '')),
      ...(agentReview ? { agentReview: true as const } : {}),
      ...(previewFixes ? { previewFixes: true as const } : {}),
      ...(siteProven ? { siteProven: true as const } : {}),
    },
  };
}
