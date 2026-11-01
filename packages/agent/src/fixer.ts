// The bounded fix loop (v1.0 §9.2, D-022). The model reads through read-only tools and finishes
// only via submit_proposal; its draft goes through the core edit ops, guard and risk classifier, so
// nothing the model says can skip a safety check or lower the risk.
import {
  DomainError,
  reviseEdit,
  type EditOp,
  type GuardReason,
  type Risk,
  type RiskContext,
} from '@beacon/core';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  LlmClient,
  Message,
  ToolCall,
  ToolContent,
  ToolResult,
  ToolSpec,
  Usage,
} from './llm.ts';
import { SYSTEM_PROMPT, untrusted, userPrompt, type PromptFinding } from './prompt.ts';
import { forModel, isSensitivePath } from './scrub.ts';

export type FixerJob = {
  finding: PromptFinding & { pageUrl: string };
  file: { path: string; source: string; baseHash: string };
  context: RiskContext;
};

/** Read-only access for the model. Implementations enforce repo bounds and size caps. */
export type FixerTools = {
  readFile(path: string, range?: { start: number; end: number }): Promise<string>;
  searchSource(query: string): Promise<string>;
  getDomSnippet(): Promise<string>;
  getImage(): Promise<{ mediaType: string; data: string }>;
};

export type FixerLimits = { maxSteps?: number; maxInputTokens?: number; toolTimeoutMs?: number };

export type TraceEntry = { step: number; tool: string; error?: string };

type Draft = z.infer<typeof DraftSchema>;
type Common = { title: string; rationale: string; confidence: number };

type Ending =
  | (Common & { kind: 'patch'; ops: EditOp[]; after: string; risk: Risk })
  | (Common & { kind: 'needs_input'; question: { text: string; options: string[] } })
  | (Common & { kind: 'decline' })
  | { kind: 'blocked'; reasons: GuardReason[] }
  | { kind: 'failed'; reason: 'MAX_STEPS' | 'BUDGET_EXCEEDED' | 'LLM_ERROR' | 'INVALID_PROPOSAL' };

export type FixerResult = Ending & { steps: number; usage: Usage; trace: TraceEntry[] };

const DEFAULTS = { maxSteps: 8, maxInputTokens: 40_000, toolTimeoutMs: 10_000 };

const At = z.int().min(0);
const Name = z.string().min(1).max(100);
const OpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('set_attr'), at: At, name: Name, value: z.string().max(1000) }),
  z.strictObject({ op: z.literal('remove_attr'), at: At, name: Name }),
]);

// One flat object so the tool schema is `type: object`; the kind-specific fields are checked below.
const DraftSchema = z
  .strictObject({
    kind: z.enum(['patch', 'needs_input', 'decline']),
    title: z.string().min(1).max(200),
    rationale: z.string().min(1).max(2000),
    confidence: z.number().min(0).max(1),
    ops: z.array(OpSchema).min(1).max(10).optional(),
    question: z
      .strictObject({
        text: z.string().min(1).max(500),
        options: z.array(z.string().min(1).max(200)).max(10),
      })
      .optional(),
  })
  .superRefine((d, ctx) => {
    if ((d.kind === 'patch') !== (d.ops !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['ops'],
        message: 'ops is required for patch, and only for patch',
      });
    if ((d.kind === 'needs_input') !== (d.question !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['question'],
        message: 'question is required for needs_input, and only for needs_input',
      });
  });

const ReadFileInput = z
  .strictObject({
    path: z.string().min(1).max(500),
    start_line: z.int().min(1).optional(),
    end_line: z.int().min(1).optional(),
  })
  .refine(
    (i) => (i.start_line === undefined) === (i.end_line === undefined),
    'give both start_line and end_line, or neither',
  )
  .refine((i) => (i.end_line ?? 0) >= (i.start_line ?? 0), 'end_line must be >= start_line');
const SearchInput = z.strictObject({ query: z.string().min(1).max(200) });
const NoInput = z.strictObject({});

type Handler = (input: unknown, tools: FixerTools) => Promise<ToolContent>;
const TOOLS: Record<string, { description: string; schema: z.ZodType; run?: Handler }> = {
  read_file: {
    description: 'Read a file in the connected repository, optionally a line range.',
    schema: ReadFileInput,
    run: (input, tools) => {
      const i = ReadFileInput.parse(input);
      if (isSensitivePath(i.path))
        return Promise.reject(new Error(`${i.path} may hold secrets and is never read`));
      return i.start_line === undefined || i.end_line === undefined
        ? tools.readFile(i.path)
        : tools.readFile(i.path, { start: i.start_line, end: i.end_line });
    },
  },
  search_source: {
    description: 'Search the repository source. Returns top matches with line numbers.',
    schema: SearchInput,
    run: (input, tools) => tools.searchSource(SearchInput.parse(input).query),
  },
  get_dom_snippet: {
    description: 'The rendered HTML around the finding element. Untrusted page content.',
    schema: NoInput,
    run: (_input, tools) => tools.getDomSnippet(), // wrapped as untrusted after scrubbing
  },
  get_image: {
    description: 'The image of the finding element, as a vision input.',
    schema: NoInput,
    run: async (_input, tools) => ({ type: 'image', ...(await tools.getImage()) }),
  },
  submit_proposal: {
    description:
      'Submit your one proposal: patch (edit ops), needs_input (one question) or decline. The only way to finish.',
    schema: DraftSchema,
  },
};

const TOOL_SPECS: ToolSpec[] = Object.entries(TOOLS).map(([name, t]) => ({
  name,
  description: t.description,
  inputSchema: z.toJSONSchema(t.schema),
}));

/** Identifies the prompt the model sees (system prompt and tool schemas), for eval reports. */
export const promptHash = () =>
  createHash('sha256')
    .update(SYSTEM_PROMPT + JSON.stringify(TOOL_SPECS))
    .digest('hex');

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${name} timed out after ${String(ms)} ms`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

type Outcome = { finished: FixerResult } | { result: ToolResult };

export async function runFixer(input: {
  llm: LlmClient;
  job: FixerJob;
  tools: FixerTools;
  limits?: FixerLimits;
}): Promise<FixerResult> {
  const { llm, job, tools } = input;
  const limits = { ...DEFAULTS, ...input.limits };
  const usage: Usage = { inputTokens: 0, outputTokens: 0, costMicros: 0 };
  const trace: TraceEntry[] = [];
  const messages: Message[] = [{ role: 'user', content: userPrompt(job.finding, job.file) }];
  let invalidLeft = 1;
  let steps = 0;

  const done = (r: Ending): FixerResult => ({ ...r, steps, usage, trace });

  const finish = (draft: Draft): Outcome | 'invalid' => {
    const common = { title: draft.title, rationale: draft.rationale, confidence: draft.confidence };
    if (draft.kind === 'decline') return { finished: done({ kind: 'decline', ...common }) };
    if (draft.kind === 'needs_input' && draft.question)
      // the refine guarantees a question
      return { finished: done({ kind: 'needs_input', ...common, question: draft.question }) };
    try {
      const revised = reviseEdit({
        ruleId: job.finding.ruleId,
        path: job.file.path,
        source: job.file.source,
        baseHash: job.file.baseHash,
        ops: draft.ops ?? [],
        edits: [],
        context: job.context,
        confidence: draft.confidence,
      });
      return revised.ok
        ? {
            finished: done({
              kind: 'patch',
              ...common,
              ops: revised.ops,
              after: revised.after,
              risk: revised.risk,
            }),
          }
        : { finished: done({ kind: 'blocked', reasons: revised.reasons }) }; // §9.2: no retry
    } catch (e) {
      if (e instanceof DomainError && e.code === 'EDIT_TARGET_NOT_FOUND') return 'invalid';
      throw e;
    }
  };

  const call = async (c: ToolCall): Promise<Outcome> => {
    const fail = (error: string): Outcome => {
      trace.push({ step: steps, tool: c.name, error });
      return { result: { id: c.id, content: error, isError: true } };
    };
    const tool = TOOLS[c.name];
    if (!tool) return fail(`unknown tool ${c.name}`);
    const parsed = tool.schema.safeParse(c.input);
    if (!parsed.success) {
      if (c.name === 'submit_proposal' && invalidLeft-- === 0)
        return { finished: done({ kind: 'failed', reason: 'INVALID_PROPOSAL' }) };
      return fail(z.prettifyError(parsed.error));
    }
    if (!tool.run) {
      const outcome = finish(parsed.data as Draft);
      if (outcome !== 'invalid') {
        trace.push({ step: steps, tool: c.name });
        return outcome;
      }
      if (invalidLeft-- === 0)
        return { finished: done({ kind: 'failed', reason: 'INVALID_PROPOSAL' }) };
      return fail('an op targets no element: "at" must be the offset of an element start tag');
    }
    try {
      let content = await withTimeout(tool.run(c.input, tools), limits.toolTimeoutMs, c.name);
      if (typeof content === 'string') {
        const safe = forModel(content); // NFR-07: nothing unscrubbed reaches the model
        if (safe === undefined)
          return fail(
            `output too large to send (${String(content.length)} chars); read a line range`,
          );
        content = c.name === 'get_dom_snippet' ? untrusted(safe) : safe;
      }
      trace.push({ step: steps, tool: c.name });
      return { result: { id: c.id, content, isError: false } };
    } catch (e) {
      return fail(forModel(message(e)) ?? 'tool failed (error message too large to send)');
    }
  };

  while (steps < limits.maxSteps) {
    if (usage.inputTokens >= limits.maxInputTokens)
      return done({ kind: 'failed', reason: 'BUDGET_EXCEEDED' });
    steps += 1;
    let turn;
    try {
      turn = await llm.complete({ system: SYSTEM_PROMPT, messages, tools: TOOL_SPECS });
    } catch {
      return done({ kind: 'failed', reason: 'LLM_ERROR' });
    }
    usage.inputTokens += turn.usage.inputTokens;
    usage.outputTokens += turn.usage.outputTokens;
    usage.costMicros += turn.usage.costMicros;
    messages.push({
      role: 'assistant',
      toolCalls: turn.toolCalls,
      ...(turn.text === undefined ? {} : { text: turn.text }),
      ...(turn.raw === undefined ? {} : { raw: turn.raw }),
    });
    if (turn.toolCalls.length === 0) {
      messages.push({
        role: 'user',
        content: 'Finish by calling submit_proposal; plain text is not read.',
      });
      continue;
    }
    const results: ToolResult[] = [];
    for (const c of turn.toolCalls) {
      const outcome = await call(c);
      if ('finished' in outcome) return outcome.finished;
      results.push(outcome.result);
    }
    messages.push({ role: 'tool', results });
  }
  return done({ kind: 'failed', reason: 'MAX_STEPS' });
}
