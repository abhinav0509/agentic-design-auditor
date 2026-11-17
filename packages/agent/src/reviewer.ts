import type { LlmClient, Usage } from './llm.ts';

export type ReviewCandidate =
  | { id: string; kind: 'image'; selector: string; alt: string; context: string }
  | { id: string; kind: 'link'; selector: string; text: string; href: string; context: string };
export type ReviewTools = { getImage(id: string): Promise<{ mediaType: string; data: string }> };
export type ReviewFlag = {
  id: string;
  kind: 'unhelpful_alt' | 'vague_link';
  reason: string;
  suggestion: string;
};
export type ReviewResult = (
  | { kind: 'done'; flags: ReviewFlag[] }
  | { kind: 'failed'; reason: 'MAX_STEPS' | 'BUDGET_EXCEEDED' | 'LLM_ERROR' | 'INVALID_REVIEW' }
) & { steps: number; usage: Usage; trace: { step: number; tool: string; error?: string }[] };

export function runReviewer(_input: {
  llm: LlmClient;
  job: { pageUrl: string; candidates: ReviewCandidate[] };
  tools: ReviewTools;
  limits?: { maxSteps?: number; maxInputTokens?: number; toolTimeoutMs?: number };
}): Promise<ReviewResult> {
  return Promise.reject(new Error('not implemented'));
}
