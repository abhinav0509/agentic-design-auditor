// The Proposal contract (v1.0 §8.1). Strict everywhere: agent output is untrusted input.
import { z } from 'zod';

const Target = z
  .strictObject({
    // regex too, so the exported JSON Schema carries the http(s)-only rule
    page_url: z.url({ protocol: /^https?$/ }).regex(/^https?:\/\//),
    selector: z.string().min(1),
    file: z.string().min(1),
    range: z.strictObject({
      start_line: z.int().min(1),
      end_line: z.int().min(1),
    }),
  })
  .refine((t) => t.range.end_line >= t.range.start_line, {
    message: 'range.end_line must be >= range.start_line',
    path: ['range'],
  });

const Change = z.strictObject({
  format: z.string().min(1),
  diff: z.string().min(1).max(100_000),
  stats: z.strictObject({
    files: z.int().min(1),
    added: z.int().min(0),
    removed: z.int().min(0),
  }),
});

const Risk = z.strictObject({
  level: z.enum(['low', 'medium', 'high']),
  reasons: z.array(z.string().min(1)),
  reversible: z.boolean(),
});

const Verification = z.strictObject({
  violation_resolved: z.boolean(),
  new_violations: z.int().min(0),
  visual_diff_ratio: z.number().min(0).max(1),
});

const Question = z.strictObject({
  text: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(200)).max(10),
});

const common = {
  schema_version: z.literal('1.0'),
  proposal_id: z.uuid(),
  run_id: z.uuid(),
  agent: z.strictObject({ name: z.string().min(1), version: z.string().min(1) }),
  title: z.string().min(1).max(200),
  rationale: z.string().min(1).max(2000),
  rule: z.strictObject({
    id: z.string().min(1),
    standard_refs: z.array(z.string().min(1)),
    impact: z.enum(['minor', 'moderate', 'serious', 'critical']),
  }),
  target: Target,
  confidence: z.number().min(0).max(1),
  evidence: z.strictObject({
    before_screenshot: z.string().min(1).nullable(),
    after_screenshot: z.string().min(1).nullable(),
    agent_trace_id: z.uuid(),
  }),
  base: z.strictObject({
    commit_sha: z.string().regex(/^[0-9a-f]{7,40}$/),
    content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  }),
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
};

export const ProposalSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...common,
      kind: z.literal('patch'),
      change: Change,
      risk: Risk,
      verification: Verification,
      question: z.null(),
    }),
    z.strictObject({
      ...common,
      kind: z.literal('needs_input'),
      change: z.null(),
      risk: Risk.nullable().optional(),
      verification: z.null(),
      question: Question,
    }),
    z.strictObject({
      ...common,
      kind: z.literal('decline'),
      change: z.null(),
      risk: Risk.nullable().optional(),
      verification: z.null(),
      question: z.null(),
    }),
  ])
  .refine((p) => Date.parse(p.expires_at) > Date.parse(p.created_at), {
    message: 'expires_at must be after created_at',
    path: ['expires_at'],
  });

export type Proposal = z.infer<typeof ProposalSchema>;

/** Throws a ZodError listing every violation. */
export const parseProposal = (input: unknown): Proposal => ProposalSchema.parse(input);

/** JSON Schema for adapter consumers outside TypeScript. Refinements are not representable. */
export const proposalJsonSchema = () => z.toJSONSchema(ProposalSchema);
