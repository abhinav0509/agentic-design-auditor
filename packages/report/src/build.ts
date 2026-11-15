export type ReportInput = {
  siteUrl: string;
  scannedAt: string;
  pages: { url: string; error: string | null }[];
  issues: {
    pageUrl: string;
    ruleId: string;
    actionable: boolean;
    impact: string;
    selector: string;
    html: string;
    help: string | null;
    tags: string[];
    crop: string | null;
  }[];
};
export type Report = {
  groups: {
    rule: string;
    title: string;
    impact: string;
    kind: 'wcag' | 'best-practice';
    refs: string[];
    fixable: boolean;
    count: number;
    instances: { pageUrl: string; selector: string; html: string; crop: string | null }[];
  }[];
  totals: {
    issues: number;
    byImpact: { critical: number; serious: number; moderate: number; minor: number };
    pagesScanned: number;
    pagesNotScanned: number;
  };
  notScanned: { url: string; reason: string }[];
  coverage: { summary: string; checked: string[]; notChecked: string[] };
};

export function buildReport(_input: ReportInput): Report {
  throw new Error('not implemented');
}
