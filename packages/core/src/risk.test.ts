// Risk classifier (v1.0 §6.3): risk = max(rule, size, context, model). Computed by code; the model's
// confidence can only raise it.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EditOp } from './edit-ops.ts';
import {
  classifyRisk,
  contextRisk,
  modelRisk,
  rank,
  ruleRisk,
  sizeRisk,
  type RiskInput,
} from './risk.ts';

const setAttr = (name: string, value: string): EditOp => ({ op: 'set_attr', at: 0, name, value });

const base = (overrides: Partial<RiskInput> = {}): RiskInput => ({
  ruleId: 'html-has-lang',
  ops: [setAttr('lang', 'en')],
  changedLines: 1,
  context: {
    pageUrl: 'https://example.com/about',
    insideForm: false,
    decorativeAgreed: false,
    visualDiffRatio: 0,
  },
  confidence: 0.95,
  ...overrides,
});
const withContext = (c: Partial<RiskInput['context']>) =>
  base({ context: { ...base().context, ...c } });

describe('classifyRisk', () => {
  it('a small, confident document-language fix is low with no reasons', () => {
    expect(classifyRisk(base())).toEqual({ level: 'low', reasons: [] });
  });

  it('decorative alt="" is low only when the verifier agrees the image is decorative', () => {
    const decorative = { ruleId: 'image-alt', ops: [setAttr('alt', '')] };
    expect(classifyRisk({ ...withContext({ decorativeAgreed: true }), ...decorative }).level).toBe(
      'low',
    );
    expect(classifyRisk(base(decorative))).toEqual({
      level: 'medium',
      reasons: ['decorative_not_confirmed'],
    });
  });

  it('generated alt text for an informative image is medium', () => {
    expect(
      classifyRisk(base({ ruleId: 'image-alt', ops: [setAttr('alt', 'Founder with product')] })),
    ).toEqual({
      level: 'medium',
      reasons: ['generated_text'],
    });
  });

  it('a label taken from existing visible text is low; generated aria-label text is medium', () => {
    expect(
      classifyRisk(base({ ruleId: 'label', ops: [setAttr('aria-labelledby', 'search-label')] }))
        .level,
    ).toBe('low');
    expect(
      classifyRisk(base({ ruleId: 'label', ops: [setAttr('aria-label', 'Search')] })).level,
    ).toBe('medium');
  });

  it('a rule outside the verified set is high', () => {
    expect(classifyRisk(base({ ruleId: 'color-contrast' }))).toEqual({
      level: 'high',
      reasons: ['unverified_rule'],
    });
  });

  it.each([
    ['https://shop.example/checkout', 'sensitive_flow'],
    ['https://shop.example/cart/step-2', 'sensitive_flow'],
    ['https://shop.example/account/login', 'sensitive_flow'],
    ['https://shop.example/sign-in', 'sensitive_flow'],
  ])('anything on %s is high (%s)', (pageUrl, reason) => {
    expect(classifyRisk(withContext({ pageUrl }))).toEqual({ level: 'high', reasons: [reason] });
  });

  it('anything inside a <form> is high', () => {
    expect(classifyRisk(withContext({ insideForm: true }))).toEqual({
      level: 'high',
      reasons: ['inside_form'],
    });
  });

  it('a visual diff over the threshold is high', () => {
    expect(classifyRisk(withContext({ visualDiffRatio: 0.02 }))).toEqual({
      level: 'high',
      reasons: ['visual_change'],
    });
  });

  it('an oversized patch is high', () => {
    expect(classifyRisk(base({ changedLines: 31 }))).toEqual({
      level: 'high',
      reasons: ['patch_size'],
    });
  });

  it('low model confidence raises even the safest fix', () => {
    expect(classifyRisk(base({ confidence: 0.3 }))).toEqual({
      level: 'high',
      reasons: ['low_model_confidence'],
    });
    expect(classifyRisk(base({ confidence: 0.6 })).level).toBe('medium');
  });

  it('collects reasons from every raised input, sorted and unique', () => {
    const r = classifyRisk({
      ...withContext({ insideForm: true }),
      ruleId: 'image-alt',
      ops: [setAttr('alt', 'x'), setAttr('alt', 'y')],
      confidence: 0.6,
    });
    expect(r.level).toBe('high');
    expect(r.reasons).toEqual(['generated_text', 'inside_form', 'low_model_confidence']);
  });
});

describe('risk properties', () => {
  const arbInput = fc.record({
    ruleId: fc.constantFrom('image-alt', 'html-has-lang', 'label', 'color-contrast'),
    ops: fc.array(
      fc.record({
        op: fc.constant('set_attr' as const),
        at: fc.nat(),
        name: fc.constantFrom('alt', 'lang', 'aria-label', 'aria-labelledby', 'id', 'for'),
        value: fc.string({ maxLength: 20 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    changedLines: fc.integer({ min: 1, max: 60 }),
    context: fc.record({
      pageUrl: fc.constantFrom(
        'https://a.example/',
        'https://a.example/checkout',
        'https://a.example/blog/1',
      ),
      insideForm: fc.boolean(),
      decorativeAgreed: fc.boolean(),
      visualDiffRatio: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  });

  it('is exactly the max of its four inputs', () => {
    fc.assert(
      fc.property(arbInput, (x) => {
        const parts = [
          ruleRisk(x.ruleId, x.ops, x.context),
          sizeRisk(x.changedLines),
          contextRisk(x.context),
          modelRisk(x.confidence),
        ];
        expect(rank(classifyRisk(x).level)).toBe(Math.max(...parts.map((p) => rank(p.level))));
      }),
    );
  });

  it('the model can raise risk but never lower it', () => {
    fc.assert(
      fc.property(arbInput, (x) => {
        expect(rank(classifyRisk(x).level)).toBeGreaterThanOrEqual(
          rank(classifyRisk({ ...x, confidence: 1 }).level),
        );
      }),
    );
  });

  it('generated text is never low', () => {
    fc.assert(
      fc.property(arbInput, fc.string({ minLength: 1 }), (x, text) => {
        const ops: EditOp[] = [setAttr('alt', text)];
        expect(classifyRisk({ ...x, ruleId: 'image-alt', ops }).level).not.toBe('low');
      }),
    );
  });

  it('risk never decreases as the patch grows', () => {
    fc.assert(
      fc.property(
        arbInput,
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (x, n, extra) => {
          const smaller = rank(classifyRisk({ ...x, changedLines: n }).level);
          const larger = rank(classifyRisk({ ...x, changedLines: n + extra }).level);
          expect(larger).toBeGreaterThanOrEqual(smaller);
        },
      ),
    );
  });
});
