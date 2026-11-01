// The eval report (addendum F.7): rates with 95% intervals, and everything needed to compare runs.
import { describe, expect, it } from 'vitest';
import { checkBudget, estimateCaseMicros, Budget } from './budget.ts';
import { buildReport, renderMarkdown, type RunMeta } from './report.ts';
import type { CaseScore } from './score.ts';

const meta: RunMeta = {
  startedAt: '2026-11-01T10:00:00.000Z',
  model: 'claude-opus-5-5',
  effort: 'medium',
  promptVersion: '1',
  promptHash: 'p'.repeat(64),
  corpusHash: 'c'.repeat(64),
  engineVersion: 'abc1234',
  judgeVersion: null,
  budgetMicros: 5_000_000,
};
const score = (over: Partial<CaseScore>): CaseScore => ({
  id: 'x',
  kind: 'fix',
  outcome: 'patch',
  attempted: true,
  valid: true,
  effective: true,
  injectionSucceeded: null,
  obeyedButBlocked: false,
  costMicros: 50_000,
  steps: 3,
  models: ['claude-opus-5-5'],
  ...over,
});

describe('buildReport', () => {
  const report = buildReport(
    meta,
    [
      score({ id: 'a' }),
      score({ id: 'b', effective: false }),
      score({ id: 'c', outcome: 'blocked', valid: false, effective: false }),
      score({ id: 'd', outcome: 'needs_input', attempted: false, valid: null, effective: null }),
      score({
        id: 'e',
        kind: 'injection',
        outcome: 'blocked',
        valid: false,
        effective: false,
        injectionSucceeded: false,
        obeyedButBlocked: true,
      }),
      score({ id: 'f', kind: 'injection', outcome: 'patch', injectionSucceeded: false }),
    ],
    ['g'],
  );

  it('rates validity and effectiveness over attempted fix cases, with Wilson intervals', () => {
    expect(report.metrics.validity).toMatchObject({ k: 2, n: 3 });
    expect(report.metrics.effectiveness).toMatchObject({ k: 1, n: 3 });
    expect(report.metrics.validity.low).toBeLessThan(report.metrics.validity.rate ?? 0);
  });

  it('NFR-02: counts successful injections, and the ones only the guard stopped', () => {
    expect(report.metrics.injection).toMatchObject({ successes: 0, n: 2, obeyedButBlocked: 1 });
  });

  it('NFR-05: reports cost, steps, restraint, skipped cases and every model that answered', () => {
    expect(report.cost).toMatchObject({ totalMicros: 300_000, meanPerCaseMicros: 50_000 });
    expect(report.restraint).toEqual({ needs_input: 1, decline: 0 });
    expect(report.skipped).toEqual(['g']);
    expect(report.servedBy).toEqual(['claude-opus-5-5']);
    expect(report.meta).toEqual(meta);
  });

  it('renders a markdown summary with the intervals and the run identity', () => {
    const md = renderMarkdown(report);
    expect(md).toMatch(/Validity.*2\/3.*%.*95% CI/s);
    expect(md).toContain('claude-opus-5-5');
    expect(md).toContain('abc1234');
    expect(md).toMatch(/Successful injections.*0\/2/);
  });
});

describe('budget', () => {
  it('estimates a case from typical token use at the model price', () => {
    // 8 000 input and 1 500 output tokens at $4 / $20 per MTok
    expect(estimateCaseMicros({ inputPerMTok: 4, outputPerMTok: 20 })).toBe(8000 * 4 + 1500 * 20);
  });

  it('NFR-05: refuses a run whose estimate is over budget, before any call', () => {
    expect(() => {
      checkBudget(100, 62_000, 5_000_000);
    }).toThrow(/over budget.*\$6\.20.*\$5\.00/);
    expect(() => {
      checkBudget(30, 62_000, 5_000_000);
    }).not.toThrow();
  });

  it('NFR-05: stops starting cases once the next one could cross the budget', () => {
    const b = new Budget(100_000, 62_000);
    expect(b.canStart()).toBe(true);
    b.spend(50_000);
    expect(b.canStart()).toBe(false); // 50 000 + 62 000 > 100 000
    expect(b.spentMicros).toBe(50_000);
  });
});
