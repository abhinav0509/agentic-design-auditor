// The provider-neutral model interface (CLAUDE.md: LlmClient is injected). A provider adapter maps
// these shapes to its API; tests use FakeLlm. Retries on transient errors belong to the adapter.
export type Usage = { inputTokens: number; outputTokens: number; costMicros: number };

export type ToolCall = { id: string; name: string; input: unknown };

export type ToolContent = string | { type: 'image'; mediaType: string; data: string };
export type ToolResult = { id: string; content: ToolContent; isError: boolean };

export type Message =
  | { role: 'user'; content: string }
  // raw: the provider's own content for this turn, echoed back unchanged (thinking blocks)
  | { role: 'assistant'; toolCalls: ToolCall[]; text?: string; raw?: unknown }
  | { role: 'tool'; results: ToolResult[] };

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type LlmRequest = { system: string; messages: Message[]; tools: ToolSpec[] };

/** model: which model actually answered (a server-side fallback can serve a refused turn). */
export type LlmTurn = {
  toolCalls: ToolCall[];
  text?: string;
  usage: Usage;
  raw?: unknown;
  model?: string;
};

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmTurn>;
}
