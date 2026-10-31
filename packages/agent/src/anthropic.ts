// LlmClient over the Anthropic Messages API (D-025). Maps the provider-neutral turn shapes to the
// beta Messages endpoint; assistant turns are echoed back verbatim so thinking blocks stay valid.
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaBase64ImageSource,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  MessageCreateParamsNonStreaming as BetaMessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { LlmClient, LlmRequest, LlmTurn, Message } from './llm.ts';
import type { ModelConfig } from './models.ts';

/** The one SDK call the adapter uses; injected so tests never touch the network. */
export type MessagesApi = {
  create(params: BetaMessageCreateParamsNonStreaming): Promise<BetaMessage>;
};

const MAX_TOKENS = 16_000;

function toParam(m: Message): BetaMessageParam {
  if (m.role === 'user') return { role: 'user', content: m.content };
  if (m.role === 'assistant') {
    if (m.raw !== undefined)
      return { role: 'assistant', content: m.raw as BetaContentBlockParam[] };
    return {
      role: 'assistant',
      content: [
        ...(m.text ? [{ type: 'text' as const, text: m.text }] : []),
        ...m.toolCalls.map((c) => ({
          type: 'tool_use' as const,
          id: c.id,
          name: c.name,
          input: c.input,
        })),
      ],
    };
  }
  return {
    role: 'user',
    content: m.results.map((r) => ({
      type: 'tool_result' as const,
      tool_use_id: r.id,
      content:
        typeof r.content === 'string'
          ? r.content
          : [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  // getImage implementations return one of the four formats the API takes
                  media_type: r.content.mediaType as BetaBase64ImageSource['media_type'],
                  data: r.content.data,
                },
              },
            ],
      is_error: r.isError,
    })),
  };
}

export class AnthropicLlm implements LlmClient {
  private readonly api: MessagesApi;
  private readonly model: ModelConfig;

  constructor(api: MessagesApi, model: ModelConfig) {
    this.api = api;
    this.model = model;
  }

  async complete(request: LlmRequest): Promise<LlmTurn> {
    const reply = await this.api.create({
      model: this.model.id,
      max_tokens: MAX_TOKENS,
      output_config: { effort: this.model.effort },
      // The system prompt is identical on every call, so it is the cache prefix.
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      tools: request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as BetaTool['input_schema'], // zod's JSON Schema, type: object
      })),
      messages: request.messages.map(toParam),
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (reply.stop_reason === 'refusal')
      throw new Error(`model refused (${reply.stop_details?.category ?? 'no category'})`);
    if (reply.stop_reason === 'max_tokens') throw new Error('reply cut off at max_tokens');

    const u = reply.usage;
    const written = u.cache_creation_input_tokens ?? 0;
    const read = u.cache_read_input_tokens ?? 0;
    const p = this.model;
    const text = reply.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
    return {
      toolCalls: reply.content.flatMap((b) =>
        b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [],
      ),
      ...(text ? { text } : {}),
      usage: {
        inputTokens: u.input_tokens + written + read,
        outputTokens: u.output_tokens,
        // $ per MTok × tokens = micro-dollars
        costMicros:
          u.input_tokens * p.inputPerMTok +
          written * p.cacheWritePerMTok +
          read * p.cacheReadPerMTok +
          u.output_tokens * p.outputPerMTok,
      },
      raw: reply.content,
    };
  }
}

/** The real client: key from ANTHROPIC_API_KEY (or an `ant` profile); one retry on transient errors (§9.2). */
export const anthropicFromEnv = (model: ModelConfig): AnthropicLlm =>
  new AnthropicLlm(new Anthropic({ maxRetries: 1 }).beta.messages, model);
