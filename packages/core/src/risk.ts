// Risk classifier (v1.0 §6.3): risk = max(rule, size, context, model), each a pure function.
// shortcut: thresholds are first guesses; calibrate on the eval corpus before Phase 1 exit.
import type { EditOp } from './edit-ops.ts';

export type RiskLevel = 'low' | 'medium' | 'high';
export type RiskReason =
  | 'decorative_not_confirmed'
  | 'generated_text'
  | 'inside_form'
  | 'low_model_confidence'
  | 'patch_size'
  | 'sensitive_flow'
  | 'unverified_rule'
  | 'visual_change';
export type Risk = { level: RiskLevel; reasons: RiskReason[] };

export type RiskContext = {
  pageUrl: string;
  insideForm: boolean;
  decorativeAgreed: boolean;
  visualDiffRatio: number;
};
export type RiskInput = {
  ruleId: string;
  ops: EditOp[];
  changedLines: number;
  context: RiskContext;
  confidence: number;
};

const LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high'];
export const rank = (level: RiskLevel) => LEVELS.indexOf(level);

const VERIFIED_RULES = new Set(['image-alt', 'html-has-lang', 'label']);
const GENERATED_TEXT_ATTRS = new Set(['alt', 'aria-label']);
const SENSITIVE_PATH = /\b(?:checkout|cart|login|log-in|signin|sign-in|account|payment|pay)\b/i;
const VISUAL_DIFF_THRESHOLD = 0.01;

const LOW: Risk = { level: 'low', reasons: [] };

function maxRisk(parts: Risk[]): Risk {
  const level = LEVELS[Math.max(...parts.map((p) => rank(p.level)))] ?? 'high';
  const reasons = [...new Set(parts.flatMap((p) => p.reasons))].sort();
  return { level, reasons };
}

export function ruleRisk(ruleId: string, ops: EditOp[], context: RiskContext): Risk {
  if (!VERIFIED_RULES.has(ruleId)) return { level: 'high', reasons: ['unverified_rule'] };
  const parts = ops.map((op): Risk => {
    if (op.op !== 'set_attr' || !GENERATED_TEXT_ATTRS.has(op.name)) return LOW;
    if (op.value !== '') return { level: 'medium', reasons: ['generated_text'] };
    return context.decorativeAgreed
      ? LOW
      : { level: 'medium', reasons: ['decorative_not_confirmed'] };
  });
  return maxRisk([LOW, ...parts]);
}

export function sizeRisk(changedLines: number): Risk {
  if (changedLines > 30) return { level: 'high', reasons: ['patch_size'] };
  if (changedLines > 10) return { level: 'medium', reasons: ['patch_size'] };
  return LOW;
}

export function contextRisk(context: RiskContext): Risk {
  const parts: Risk[] = [LOW];
  // pageUrl is schema-validated; a bad one throws, which fails closed (no proposal is created).
  if (SENSITIVE_PATH.test(new URL(context.pageUrl).pathname)) {
    parts.push({ level: 'high', reasons: ['sensitive_flow'] });
  }
  if (context.insideForm) parts.push({ level: 'high', reasons: ['inside_form'] });
  if (context.visualDiffRatio > VISUAL_DIFF_THRESHOLD) {
    parts.push({ level: 'high', reasons: ['visual_change'] });
  }
  return maxRisk(parts);
}

export function modelRisk(confidence: number): Risk {
  if (!(confidence >= 0.5)) return { level: 'high', reasons: ['low_model_confidence'] }; // NaN too
  if (confidence < 0.8) return { level: 'medium', reasons: ['low_model_confidence'] };
  return LOW;
}

export function classifyRisk(input: RiskInput): Risk {
  return maxRisk([
    ruleRisk(input.ruleId, input.ops, input.context),
    sizeRisk(input.changedLines),
    contextRisk(input.context),
    modelRisk(input.confidence),
  ]);
}
