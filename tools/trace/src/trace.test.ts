import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coveredIds, parseRegistry, uncovered, unknownIds } from './trace.ts';

type Status = 'passed' | 'failed' | 'pending' | 'todo' | 'skipped';
const report = (...tests: [fullName: string, status: Status][]) => ({
  testResults: [{ assertionResults: tests.map(([fullName, status]) => ({ fullName, status })) }],
});

const registry = parseRegistry(`
current_phase: 1
requirements:
  - { id: FR-04, phase: 1, text: verify site }
  - { id: FR-04a, phase: 1, text: prove url ownership }
  - { id: FR-13, phase: 1, text: idempotent decisions }
  - { id: FR-17, phase: 2, text: report }
`);

describe('uncovered', () => {
  it('lists in-phase requirements that no passing test names', () => {
    const covered = coveredIds(report(['decisions FR-13: idempotent', 'passed']));
    expect(uncovered(registry, covered).map((r) => r.id)).toEqual(['FR-04', 'FR-04a']);
  });

  it('ignores requirements from later phases', () => {
    const covered = coveredIds(
      report(['FR-04: a', 'passed'], ['FR-04a: b', 'passed'], ['FR-13: c', 'passed']),
    );
    expect(uncovered(registry, covered)).toEqual([]);
  });
});

describe('coveredIds', () => {
  it('counts only passed tests, never todo, skipped, pending or failed', () => {
    const covered = coveredIds(
      report(
        ['FR-04: a', 'todo'],
        ['FR-04: b', 'skipped'],
        ['FR-04: c', 'pending'],
        ['FR-04: d', 'failed'],
      ),
    );
    expect([...covered]).toEqual([]);
  });

  it('finds IDs anywhere in the full name, including describe blocks', () => {
    expect([...coveredIds(report(['FR-13 decisions > rejects stale', 'passed']))]).toEqual([
      'FR-13',
    ]);
  });

  it('does not confuse FR-04 with FR-04a', () => {
    expect([...coveredIds(report(['FR-04a: dns txt', 'passed']))]).toEqual(['FR-04a']);
  });

  it('collects several IDs from one test', () => {
    expect([...coveredIds(report(['FR-13 and NFR-03: no duplicates', 'passed']))].sort()).toEqual([
      'FR-13',
      'NFR-03',
    ]);
  });

  it('rejects a report that is not vitest json', () => {
    expect(() => coveredIds({ nope: true })).toThrow(/vitest json/i);
  });
});

describe('unknownIds', () => {
  it('flags IDs used in tests that are not in the registry (typos)', () => {
    expect(unknownIds(registry, new Set(['FR-13', 'FR-99']))).toEqual(['FR-99']);
  });
});

describe('parseRegistry', () => {
  it('rejects duplicate IDs', () => {
    const yaml = `current_phase: 0
requirements:
  - { id: FR-01, phase: 1, text: a }
  - { id: FR-01, phase: 1, text: b }`;
    expect(() => parseRegistry(yaml)).toThrow(/duplicate.*FR-01/i);
  });

  it('rejects malformed IDs', () => {
    expect(() =>
      parseRegistry(`current_phase: 0\nrequirements:\n  - { id: FR1, phase: 1, text: a }`),
    ).toThrow(/FR1/);
  });

  it('rejects a missing or non-integer phase', () => {
    expect(() => parseRegistry(`requirements: []`)).toThrow(/current_phase/);
    expect(() =>
      parseRegistry(`current_phase: 0\nrequirements:\n  - { id: FR-01, phase: 1.5, text: a }`),
    ).toThrow(/phase/);
  });

  it('accepts the real registry', () => {
    const real = parseRegistry(
      readFileSync(new URL('../../../requirements.yaml', import.meta.url), 'utf8'),
    );
    expect(real.requirements.length).toBeGreaterThan(40);
  });
});
