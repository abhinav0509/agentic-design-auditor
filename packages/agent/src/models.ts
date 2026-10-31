// Fixer model configuration (NFR-12): model and effort are config, and every model carries its
// price so budgets (NFR-05) can be enforced. Prices are USD per million tokens, first-party API.
export const MODELS = {
  'claude-opus-5-5': {
    inputPerMTok: 4,
    cacheWritePerMTok: 5,
    cacheReadPerMTok: 0.2,
    outputPerMTok: 20,
  },
  'claude-sonnet-5-5': {
    inputPerMTok: 2,
    cacheWritePerMTok: 2.5,
    cacheReadPerMTok: 0.2,
    outputPerMTok: 10,
  },
  'claude-haiku-5-5': {
    inputPerMTok: 0.1,
    cacheWritePerMTok: 0.125,
    cacheReadPerMTok: 0.01,
    outputPerMTok: 0.5,
  },
} as const;

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export type ModelConfig = (typeof MODELS)[keyof typeof MODELS] & {
  id: keyof typeof MODELS;
  effort: Effort;
};

const isModel = (id: string): id is keyof typeof MODELS => id in MODELS;
const isEffort = (e: string): e is Effort => (EFFORTS as readonly string[]).includes(e);

export function fixerModel(env: Record<string, string | undefined>): ModelConfig {
  const id = env.BEACON_FIXER_MODEL ?? 'claude-opus-5-5';
  const effort = env.BEACON_FIXER_EFFORT ?? 'medium';
  if (!isModel(id)) throw new Error(`no known price for model ${id}; add it to MODELS`);
  if (!isEffort(effort))
    throw new Error(`unknown effort ${effort}; use one of ${EFFORTS.join(', ')}`);
  return { ...MODELS[id], id, effort };
}
