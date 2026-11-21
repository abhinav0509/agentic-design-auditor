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
  /** Pages the agent reviewed (D-048); absent or empty when no review ran. */
  reviewedPages?: string[];
  /** The run's proposed fixes and the PRs they went into (FR-10, D-054). */
  fixes?: {
    id: string;
    status: string;
    title: string;
    rationale: string;
    ruleId: string;
    pageUrl: string;
    file: string;
    diff: string | undefined;
    risk: string | undefined;
    announcedBefore: string | null;
    announcedAfter: string | null;
    crop: string | null;
  }[];
  pullRequests?: { number: number; url: string; branch: string; proposalIds: string[] }[];
  reviewFlags?: {
    pageUrl: string;
    candidate: 'image' | 'link';
    kind: 'unhelpful_alt' | 'vague_link';
    selector: string;
    text: string;
    reason: string;
    suggestion: string;
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
  fixes: {
    id: string;
    title: string;
    status: string;
    /** What the status means to the reader; a fix in a PR names it. */
    statusLabel: string;
    pr: { number: number; url: string } | null;
    riskLabel: string | null;
    rationale: string;
    pageUrl: string;
    file: string;
    diff: string | null;
    announced: { before: string; after: string } | null;
    crop: string | null;
  }[];
  review: {
    reviewedPages: number;
    notReviewed: string[];
    flags: {
      pageUrl: string;
      title: string;
      label: string;
      current: string;
      reason: string;
      suggestion: string;
      crop: string | null;
    }[];
  } | null;
};

const IMPACTS = ['critical', 'serious', 'moderate', 'minor'] as const;
const severity = (impact: string) => {
  const i = (IMPACTS as readonly string[]).indexOf(impact);
  return i === -1 ? IMPACTS.length : i;
};

/** The rules Beacon fixes: our own plain titles and references (their rows carry no axe text). */
const FIXABLE: Record<string, { title: string; refs: string[] }> = {
  'image-alt': { title: 'Images need a text alternative', refs: ['WCAG 1.1.1'] },
  label: { title: 'Form fields need a label', refs: ['WCAG 1.3.1', 'WCAG 4.1.2'] },
  'html-has-lang': { title: 'The page needs to state its language', refs: ['WCAG 3.1.1'] },
};

/** axe tags such as `wcag244` become "WCAG 2.4.4"; references only, never a claim. */
const refsOf = (tags: string[]) =>
  tags.flatMap((t) => {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(t);
    return m ? [`WCAG ${m[1] ?? ''}.${m[2] ?? ''}.${m[3] ?? ''}`] : [];
  });

const REASONS: Record<string, string> = {
  URL_NOT_ALLOWED: 'The address is private or not allowed, so it was not opened.',
  SCAN_FAILED: 'The page could not be loaded.',
};

const COVERAGE = {
  summary:
    'Automated checks find only part of the barriers on a site. A human review, and testing with disabled people, are still needed before relying on these results.',
  checked: [
    'The rendered pages listed below, as a visitor would load them',
    'Every automated rule in axe-core, a widely used accessibility engine',
  ],
  notChecked: [
    'Using the site with a keyboard alone, and where focus goes',
    'How the pages sound in a screen reader, in order',
    'Whether text alternatives and labels actually make sense',
    'Video, audio, PDFs and other documents',
    'Pages behind a log in, and anything after a form is sent',
    'Pages not in the list below',
  ],
};

const REVIEW_KINDS = {
  unhelpful_alt: { title: 'Alt text that does not describe the image', label: 'Alt text' },
  vague_link: { title: 'Link text that does not say where it goes', label: 'Link text' },
} as const;

const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved, not yet in a pull request',
  rejected: 'Rejected',
  failed_verification: 'Did not pass verification',
  apply_failed: 'No longer applies to the site',
  stale: 'Out of date',
  expired: 'Expired',
  merged: 'Merged',
  reverted: 'Reverted',
  blocked: 'Blocked by the safety guard',
};
const RISK_LABELS: Record<string, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

function fixesOf(input: ReportInput): Report['fixes'] {
  const prs = input.pullRequests ?? [];
  return (input.fixes ?? []).map((f) => {
    const pr = prs.find((p) => p.proposalIds.includes(f.id));
    return {
      id: f.id,
      title: f.title,
      status: f.status,
      statusLabel:
        f.status === 'applied' && pr
          ? `In pull request #${String(pr.number)}`
          : (STATUS_LABELS[f.status] ?? f.status),
      pr: pr ? { number: pr.number, url: pr.url } : null,
      riskLabel: f.risk ? (RISK_LABELS[f.risk] ?? null) : null,
      rationale: f.rationale,
      pageUrl: f.pageUrl,
      file: f.file,
      diff: f.diff ?? null,
      announced:
        f.announcedBefore !== null && f.announcedAfter !== null
          ? { before: f.announcedBefore, after: f.announcedAfter }
          : null,
      crop: f.crop,
    };
  });
}

/** The agent review (D-048): null when none ran. */
function reviewOf(input: ReportInput): Report['review'] {
  const reviewed = input.reviewedPages ?? [];
  const flags = input.reviewFlags ?? [];
  // shortcut: no reviewed page reads as "no review ran"; a run whose every review failed looks the
  // same. Store the run's review setting when that needs telling apart.
  if (reviewed.length === 0 && flags.length === 0) return null;
  const done = new Set(reviewed);
  return {
    reviewedPages: reviewed.length,
    notReviewed: input.pages.filter((p) => p.error === null && !done.has(p.url)).map((p) => p.url),
    flags: flags.map((f) => ({
      pageUrl: f.pageUrl,
      ...REVIEW_KINDS[f.kind],
      current: f.text,
      reason: f.reason,
      suggestion: f.suggestion,
      crop: f.crop,
    })),
  };
}

export function buildReport(input: ReportInput): Report {
  const groups = new Map<string, Report['groups'][number]>();
  for (const i of input.issues) {
    let g = groups.get(i.ruleId);
    if (!g) {
      const fixable = i.actionable ? FIXABLE[i.ruleId] : undefined;
      g = {
        rule: i.ruleId,
        title: fixable?.title ?? i.help ?? i.ruleId,
        impact: i.impact,
        kind: i.tags.includes('best-practice') ? 'best-practice' : 'wcag',
        refs: fixable?.refs ?? refsOf(i.tags),
        fixable: fixable !== undefined,
        count: 0,
        instances: [],
      };
      groups.set(i.ruleId, g);
    }
    if (severity(i.impact) < severity(g.impact)) g.impact = i.impact;
    g.count++;
    g.instances.push({ pageUrl: i.pageUrl, selector: i.selector, html: i.html, crop: i.crop });
  }

  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const i of input.issues) {
    if (i.impact in byImpact) byImpact[i.impact as keyof typeof byImpact]++;
  }
  const failed = input.pages.filter((p) => p.error !== null);
  return {
    groups: [...groups.values()].sort(
      (a, b) =>
        severity(a.impact) - severity(b.impact) || b.count - a.count || (a.rule < b.rule ? -1 : 1),
    ),
    totals: {
      issues: input.issues.length,
      byImpact,
      pagesScanned: input.pages.length - failed.length,
      pagesNotScanned: failed.length,
    },
    notScanned: failed.map((p) => ({
      url: p.url,
      reason: REASONS[p.error ?? ''] ?? 'The page could not be scanned.',
    })),
    coverage: COVERAGE,
    fixes: fixesOf(input),
    review: reviewOf(input),
  };
}
