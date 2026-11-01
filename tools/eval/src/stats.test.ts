// Wilson score intervals (addendum F.7: n is small, so every rate carries a 95% interval).
import { describe, expect, it } from 'vitest';
import { wilson } from './stats.ts';

describe('wilson', () => {
  it('matches the textbook interval for 8 of 10', () => {
    const r = wilson(8, 10);
    expect(r.rate).toBe(0.8);
    expect(r.low).toBeCloseTo(0.4902, 4);
    expect(r.high).toBeCloseTo(0.9433, 4);
  });

  it('stays inside [0, 1] at the edges', () => {
    expect(wilson(30, 30)).toMatchObject({ rate: 1, high: 1 });
    expect(wilson(30, 30).low).toBeCloseTo(0.8865, 4);
    expect(wilson(0, 30)).toMatchObject({ rate: 0, low: 0 });
    expect(wilson(0, 30).high).toBeCloseTo(0.1135, 4);
  });

  it('has no rate when nothing was measured', () => {
    expect(wilson(0, 0)).toEqual({ k: 0, n: 0, rate: null, low: null, high: null });
  });
});
