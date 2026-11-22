// Honesty rule (CLAUDE.md, v1.0 §3.2, FR-31): no user-facing text claims compliance, conformance,
// certification or a single accessibility score. WCAG may be named only as a reference. Denying
// a claim (an honest disclaimer) is allowed: the phrase then has a negation in its own clause.
const CLAIMS =
  /\b(?:complian(?:t|ce)|conform(?:s|ant|ance)|certifi(?:ed|cation)|(?:passes|meets)\s+WCAG|fully\s+accessible|(?:ADA|EAA)[-\s]ready|accessibility\s+score)\b|\b100\s*%\s*accessible\b/giu;

// A phrase denied in its own clause is a disclaimer, not a claim: "it doesn't make the page compliant".
const NEGATION = /^(?:not|no|never|without|cannot|.*n['’]t)$/i;
const LOOKBACK_WORDS = 8;

function denied(text: string, at: number): boolean {
  const clause =
    text
      .slice(0, at)
      .split(/[.;:!?]/)
      .pop() ?? '';
  return clause
    .split(/\s+/)
    .filter(Boolean)
    .slice(-LOOKBACK_WORDS)
    .some((w) => NEGATION.test(w.replace(/[^\p{L}'’]/gu, '')));
}

/** The claim phrases found in `text`, as written; empty when the text is honest. */
export function complianceClaims(text: string): string[] {
  return [...text.matchAll(CLAIMS)].filter((m) => !denied(text, m.index)).map((m) => m[0]);
}
