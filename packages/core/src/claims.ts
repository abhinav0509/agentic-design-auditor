// Honesty rule (CLAUDE.md, v1.0 §3.2, FR-31): no user-facing text claims compliance, conformance,
// certification or a single accessibility score. WCAG may be named only as a reference.
const CLAIMS =
  /\b(?:complian(?:t|ce)|conform(?:s|ant|ance)|certifi(?:ed|cation)|(?:passes|meets)\s+WCAG|fully\s+accessible|(?:ADA|EAA)[-\s]ready|accessibility\s+score)\b|\b100\s*%\s*accessible\b/giu;

/** The claim phrases found in `text`, as written; empty when the text is honest. */
export function complianceClaims(text: string): string[] {
  return [...text.matchAll(CLAIMS)].map((m) => m[0]);
}
