// Test builders (D-015). Not imported by production code.
import example from './__fixtures__/proposal.example.json' with { type: 'json' };
import { parseProposal, type Proposal } from './proposal.ts';

/** Runs fn and returns what it threw (undefined if nothing), for asserting on error codes. */
export function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

/** A valid patch proposal (the §8.1 example) with top-level fields overridden; still schema-checked. */
export const makeProposal = (overrides: Record<string, unknown> = {}): Proposal =>
  parseProposal({ ...structuredClone(example), ...overrides });
