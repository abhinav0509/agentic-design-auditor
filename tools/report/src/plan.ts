export type ReportPlan = { requestedBy: string; siteUrl: string; urls: string[]; orgId: string };

export function planReport(
  _argv: string[],
): { ok: true; plan: ReportPlan } | { ok: false; error: string } {
  return { ok: false, error: 'not implemented' };
}
