// Reviewer edits (addendum 1.1): an edited value becomes a new revision that goes back through the
// edit ops, the guard and the risk classifier. Verification is added when packages/verifier exists.
import { applyEditOps, type EditOp } from './edit-ops.ts';
import { DomainError } from './errors.ts';
import { changedLines, guard, type GuardReason } from './guard.ts';
import { classifyRisk, type Risk, type RiskContext } from './risk.ts';

export type RevisionInput = {
  ruleId: string;
  path: string;
  source: string;
  baseHash: string;
  ops: EditOp[];
  edits: { index: number; value: string }[];
  context: RiskContext;
  confidence: number;
};

export type RevisionResult =
  { ok: true; ops: EditOp[]; after: string; risk: Risk } | { ok: false; reasons: GuardReason[] };

export function reviseEdit(input: RevisionInput): RevisionResult {
  const ops = input.ops.map((op) => ({ ...op }));
  for (const { index, value } of input.edits) {
    const op = ops[index];
    if (!op) throw new DomainError('INVALID_EDIT', `no edit op at index ${String(index)}`);
    if (op.op !== 'set_attr')
      throw new DomainError('INVALID_EDIT', 'only set_attr values can be edited');
    op.value = value;
  }

  const after = applyEditOps(input.source, ops);
  const checked = guard({
    ruleId: input.ruleId,
    baseHash: input.baseHash,
    files: [{ path: input.path, before: input.source, after }],
  });
  if (!checked.ok) return { ok: false, reasons: checked.reasons };

  const risk = classifyRisk({
    ruleId: input.ruleId,
    ops,
    changedLines: changedLines(input.source, after),
    context: input.context,
    confidence: input.confidence,
  });
  return { ok: true, ops, after, risk };
}
