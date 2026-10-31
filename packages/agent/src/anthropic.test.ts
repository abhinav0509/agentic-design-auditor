// The Anthropic adapter (NFR-12, NFR-05, v1.0 §9.2). No network: a fake `messages` API records the
// request and returns canned responses. Real calls only happen in the recorded eval runs.
import type {
  BetaMessage,
  BetaMessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it } from 'vitest';
import { AnthropicLlm, type MessagesApi } from './anthropic.ts';
import type { LlmRequest } from './llm.ts';
import { fixerModel, MODELS } from './models.ts';

const reply = (over: Partial<BetaMessage> = {}): BetaMessage =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Looking at the file.' },
      { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'about.html' } },
    ],
    stop_reason: 'tool_use',
    stop_details: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...over,
  }) as BetaMessage;

class FakeApi implements MessagesApi {
  readonly params: BetaMessageCreateParamsNonStreaming[] = [];
  constructor(private readonly response: BetaMessage | Error = reply()) {}
  create(p: BetaMessageCreateParamsNonStreaming): Promise<BetaMessage> {
    this.params.push(structuredClone(p));
    return this.response instanceof Error
      ? Promise.reject(this.response)
      : Promise.resolve(this.response);
  }
}

const request = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  system: 'SYSTEM PROMPT',
  tools: [
    {
      name: 'read_file',
      description: 'Read a file.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  messages: [{ role: 'user', content: 'Fix this.' }],
  ...over,
});

const opus = () => fixerModel({});

describe('fixerModel (NFR-12)', () => {
  it('NFR-12: defaults to Opus 5.5 at medium effort, with its price', () => {
    expect(opus()).toEqual({
      ...MODELS['claude-opus-5-5'],
      id: 'claude-opus-5-5',
      effort: 'medium',
    });
    expect(MODELS['claude-opus-5-5']).toMatchObject({ inputPerMTok: 4, outputPerMTok: 20 });
  });

  it('NFR-12: model and effort come from configuration', () => {
    expect(
      fixerModel({ BEACON_FIXER_MODEL: 'claude-sonnet-5-5', BEACON_FIXER_EFFORT: 'low' }),
    ).toMatchObject({
      id: 'claude-sonnet-5-5',
      effort: 'low',
      inputPerMTok: 2,
    });
  });

  it('refuses a model without a known price, so budgets can always be enforced', () => {
    expect(() => fixerModel({ BEACON_FIXER_MODEL: 'claude-unknown-1' })).toThrow(/price/);
    expect(() => fixerModel({ BEACON_FIXER_EFFORT: 'extreme' })).toThrow(/effort/);
  });
});

describe('AnthropicLlm', () => {
  it('sends the configured model and effort, a cached system prompt, the tools and server-side fallbacks', async () => {
    const api = new FakeApi();
    await new AnthropicLlm(api, opus()).complete(request());
    expect(api.params[0]).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          name: 'read_file',
          description: 'Read a file.',
          input_schema: { type: 'object', properties: {} },
        },
      ],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect(api.params[0]?.max_tokens).toBeGreaterThanOrEqual(8000);
    expect(api.params[0]).not.toHaveProperty('tool_choice'); // forced tool use is a 400 on Opus 5.5
  });

  it('maps the reply to tool calls, text, usage and cost in micro-dollars (NFR-05)', async () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 400,
      cache_read_input_tokens: 3000,
    };
    const turn = await new AnthropicLlm(
      new FakeApi(reply({ usage } as Partial<BetaMessage>)),
      opus(),
    ).complete(request());
    expect(turn.toolCalls).toEqual([
      { id: 'toolu_1', name: 'read_file', input: { path: 'about.html' } },
    ]);
    expect(turn.text).toBe('Looking at the file.');
    // all input the model read counts against the budget; price: $4 in, $5 cache write, $0.20 cache read, $20 out per MTok
    expect(turn.usage).toEqual({
      inputTokens: 4400,
      outputTokens: 200,
      costMicros: 1000 * 4 + 400 * 5 + 3000 * 0.2 + 200 * 20,
    });
  });

  it('echoes the assistant turn back unchanged, thinking blocks included, and sends tool results as one user turn', async () => {
    const first = reply();
    const api = new FakeApi(first);
    const llm = new AnthropicLlm(api, opus());
    const turn = await llm.complete(request());
    await llm.complete(
      request({
        messages: [
          { role: 'user', content: 'Fix this.' },
          { role: 'assistant', toolCalls: turn.toolCalls, raw: turn.raw },
          {
            role: 'tool',
            results: [
              { id: 'toolu_1', content: 'file text', isError: false },
              {
                id: 'toolu_2',
                content: { type: 'image', mediaType: 'image/png', data: 'iVBO' },
                isError: false,
              },
              { id: 'toolu_3', content: 'no such file', isError: true },
            ],
          },
        ],
      }),
    );
    expect(api.params[1]?.messages).toEqual([
      { role: 'user', content: 'Fix this.' },
      { role: 'assistant', content: first.content },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file text', is_error: false },
          {
            type: 'tool_result',
            tool_use_id: 'toolu_2',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } },
            ],
            is_error: false,
          },
          { type: 'tool_result', tool_use_id: 'toolu_3', content: 'no such file', is_error: true },
        ],
      },
    ]);
  });

  it('rebuilds an assistant turn without raw content from its tool calls', async () => {
    const api = new FakeApi();
    await new AnthropicLlm(api, opus()).complete(
      request({
        messages: [
          { role: 'user', content: 'Fix this.' },
          {
            role: 'assistant',
            toolCalls: [{ id: 't1', name: 'get_image', input: {} }],
            text: 'Checking.',
          },
          { role: 'tool', results: [{ id: 't1', content: 'x', isError: false }] },
        ],
      }),
    );
    expect(api.params[0]?.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 't1', name: 'get_image', input: {} },
      ],
    });
  });

  it('a refusal fails the call with its category; nothing from that turn runs', async () => {
    const refused = reply({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' },
    } as Partial<BetaMessage>);
    await expect(
      new AnthropicLlm(new FakeApi(refused), opus()).complete(request()),
    ).rejects.toThrow(/refus.*cyber/);
  });

  it('a reply cut off at max_tokens fails the call instead of running a truncated tool call', async () => {
    const cut = reply({ stop_reason: 'max_tokens' });
    await expect(new AnthropicLlm(new FakeApi(cut), opus()).complete(request())).rejects.toThrow(
      /max_tokens/,
    );
  });

  it('API errors propagate (the SDK already retried once, v1.0 §9.2)', async () => {
    await expect(
      new AnthropicLlm(new FakeApi(new Error('overloaded')), opus()).complete(request()),
    ).rejects.toThrow('overloaded');
  });
});
