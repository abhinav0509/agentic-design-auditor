export type FixPlan = {
  owner: string;
  repo: string;
  siteUrl: string;
  urls: string[];
  orgId: string;
  requestedBy: string;
  agentReview?: true;
};
export function planFixRun(
  _argv: string[],
): { ok: true; plan: FixPlan } | { ok: false; error: string } {
  return { ok: false, error: 'not implemented' };
}
