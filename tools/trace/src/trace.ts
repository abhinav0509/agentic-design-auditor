import { parse } from 'yaml';

export type Requirement = { id: string; phase: number; text: string };
export type Registry = { currentPhase: number; requirements: Requirement[] };

const ID = /^(?:FR|NFR)-\d{2,}[a-z]?$/;
const ID_IN_TEXT = /\b(?:FR|NFR)-\d+[a-z]?\b/g;

const isPhase = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function parseRegistry(text: string): Registry {
  const { current_phase, requirements } = (parse(text) ?? {}) as Record<string, unknown>;
  if (!isPhase(current_phase)) throw new Error('current_phase must be a non-negative integer');
  if (!Array.isArray(requirements)) throw new Error('requirements must be a list');

  const seen = new Set<string>();
  const parsed = requirements.map((entry: unknown): Requirement => {
    const { id, phase, text } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new Error(`malformed requirement id: ${String(id)}`);
    }
    if (seen.has(id)) throw new Error(`duplicate requirement id: ${id}`);
    seen.add(id);
    if (!isPhase(phase)) throw new Error(`${id}: phase must be a non-negative integer`);
    if (typeof text !== 'string') throw new Error(`${id}: text must be a string`);
    return { id, phase, text };
  });
  return { currentPhase: current_phase, requirements: parsed };
}

type VitestReport = {
  testResults: { assertionResults: { fullName: string; status: string }[] }[];
};

const isVitestReport = (v: unknown): v is VitestReport =>
  typeof v === 'object' &&
  v !== null &&
  Array.isArray((v as { testResults?: unknown }).testResults);

/** Requirement IDs named by at least one passing test. Todo, skipped and failed never count. */
export function coveredIds(report: unknown): Set<string> {
  if (!isVitestReport(report)) throw new Error('not a vitest json report');
  const ids = new Set<string>();
  for (const file of report.testResults) {
    for (const test of file.assertionResults) {
      if (test.status !== 'passed') continue;
      for (const [id] of test.fullName.matchAll(ID_IN_TEXT)) ids.add(id);
    }
  }
  return ids;
}

export const uncovered = (registry: Registry, covered: Set<string>): Requirement[] =>
  registry.requirements.filter((r) => r.phase <= registry.currentPhase && !covered.has(r.id));

export function unknownIds(registry: Registry, covered: Set<string>): string[] {
  const known = new Set(registry.requirements.map((r) => r.id));
  return [...covered].filter((id) => !known.has(id)).sort();
}
