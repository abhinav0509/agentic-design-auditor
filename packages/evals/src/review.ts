export const REVIEW_PAYLOAD = 'evil.example';
export type ReviewLabel = 'flag' | 'keep';
export type ReviewEvalCase = {
  id: string;
  kind: 'plain' | 'suppression' | 'payload';
  source?: string;
  html: string;
  truth: { images: Record<string, ReviewLabel>; links: Record<string, ReviewLabel> };
  subjects: Record<string, string[]>;
};
export function reviewCases(): ReviewEvalCase[] {
  return [];
}
