// Reviewer edits (addendum 1.1): an edit becomes a new revision that goes back through the guard and
// the risk classifier. The verifier step joins when packages/verifier exists (FR-24 stays open).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EditOp } from './edit-ops.ts';
import { DomainError } from './errors.ts';
import { reviseEdit, type RevisionInput } from './revision.ts';
import { catchError } from './test-helpers.ts';

const page = readFileSync(new URL('./__fixtures__/page.html', import.meta.url), 'utf8');
const heroAt = page.indexOf('<img src="hero.jpg">');
const logoAt = page.indexOf('<img src="logo.png"');

const input = (overrides: Partial<RevisionInput> = {}): RevisionInput => ({
  ruleId: 'image-alt',
  path: 'index.html',
  source: page,
  baseHash: `sha256:${createHash('sha256').update(page).digest('hex')}`,
  ops: [{ op: 'set_attr', at: heroAt, name: 'alt', value: 'A man with a box' }],
  edits: [{ index: 0, value: 'Founder holding the product' }],
  context: {
    pageUrl: 'https://example.com/about',
    insideForm: false,
    decorativeAgreed: false,
    visualDiffRatio: 0,
  },
  confidence: 1,
  ...overrides,
});

describe('reviseEdit', () => {
  it('applies the reviewer value, re-runs the guard and re-classifies risk', () => {
    const result = reviseEdit(input());
    expect(result).toEqual({
      ok: true,
      ops: [{ op: 'set_attr', at: heroAt, name: 'alt', value: 'Founder holding the product' }],
      after: page.replace(
        '<img src="hero.jpg">',
        '<img src="hero.jpg" alt="Founder holding the product">',
      ),
      risk: { level: 'medium', reasons: ['generated_text'] },
    });
  });

  it('does not change the original ops', () => {
    const original: EditOp[] = [
      { op: 'set_attr', at: heroAt, name: 'alt', value: 'A man with a box' },
    ];
    reviseEdit(input({ ops: original }));
    expect(original[0]).toMatchObject({ value: 'A man with a box' });
  });

  it('an edit the guard rejects returns its reasons and no output', () => {
    expect(reviseEdit(input({ edits: [{ index: 0, value: 'see https://evil.example' }] }))).toEqual(
      {
        ok: false,
        reasons: ['VALUE_UNSAFE'],
      },
    );
  });

  it('quotes in a reviewer value are escaped and pass', () => {
    const result = reviseEdit(input({ edits: [{ index: 0, value: 'Our "best" product' }] }));
    expect(result.ok).toBe(true);
  });

  it('risk is recomputed: editing a confirmed decorative alt="" into text raises it to medium', () => {
    const decorative = input({
      ops: [{ op: 'set_attr', at: logoAt, name: 'alt', value: '' }],
      edits: [{ index: 0, value: 'Shop logo' }],
      context: { ...input().context, decorativeAgreed: true },
    });
    const result = reviseEdit(decorative);
    expect(result.ok && result.risk.level).toBe('medium');
  });

  it.each([
    [{ index: 1, value: 'x' }, 'index out of range'],
    [{ index: -1, value: 'x' }, 'negative index'],
  ])('rejects %j (%s) with INVALID_EDIT', (edit) => {
    const error = catchError(() => reviseEdit(input({ edits: [edit] })));
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INVALID_EDIT');
  });

  it('cannot turn a remove_attr into a value (INVALID_EDIT)', () => {
    const error = catchError(() =>
      reviseEdit(input({ ops: [{ op: 'remove_attr', at: logoAt, name: 'alt' }] })),
    );
    expect((error as DomainError).code).toBe('INVALID_EDIT');
  });
});
