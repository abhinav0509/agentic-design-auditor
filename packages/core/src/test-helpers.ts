// Test builders (D-015). Not imported by production code.
import example from './__fixtures__/proposal.example.json' with { type: 'json' };
import { parseProposal, type Proposal } from './proposal.ts';

/** A valid patch proposal (the §8.1 example) with top-level fields overridden; still schema-checked. */
export const makeProposal = (overrides: Record<string, unknown> = {}): Proposal =>
  parseProposal({ ...structuredClone(example), ...overrides });
