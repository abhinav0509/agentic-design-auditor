// Phase 1 test list (v1.0 §16.4 + addendum). Turn each todo into a real test, one at a time,
// and move it next to the code it covers once that package exists.
import { describe, it } from 'vitest';

describe('decisions', () => {
  it.todo('answering a needs_input proposal spawns a superseding attempt');
  it.todo('FR-24: an edited revision re-runs guard, verifier and risk');
});

describe('exporter', () => {
  it.todo('FR-15: revert creates a revert change');
});

describe('review kit', () => {
  it.todo('keyboard shortcuts act on the focused proposal');
  it.todo('single-key shortcuts can be turned off (WCAG 2.1.4)');
  it.todo('bulk button disabled when any item is not low risk');
  it.todo('409 shows the someone-else-decided state');
});
