// The hard-case set (v1.0 §15.1, D-030): cases where the right answer is a specific alt or a question.
import { describe, expect, it } from 'vitest';
import { loadHardCases } from './hard.ts';
import { imageFor } from './images.ts';

const cases = loadHardCases();

describe('hard cases', () => {
  it('labels each case with a good answer: an alt matching a pattern, or a question', () => {
    expect(cases.map((c) => c.id)).toEqual([
      'hard--divider',
      'hard--logo',
      'hard--hours',
      'hard--icon',
      'hard--qr',
      'hard--chart',
      'hard--field',
    ]);
    expect(cases.filter((c) => 'ask' in c.expect).map((c) => c.id)).toEqual([
      'hard--qr',
      'hard--chart',
      'hard--field',
    ]);
    for (const c of cases) {
      expect(c.html, c.id).toMatch(/^<!doctype html>/);
      expect(c.why, c.id).not.toBe('');
      if ('alt' in c.expect)
        expect(new RegExp(c.expect.alt, 'i').test(''), c.id).toBe(c.id === 'hard--divider');
    }
  });

  it('every image on a hard page has a drawn image', () => {
    for (const c of cases)
      for (const m of c.html.matchAll(/\ssrc="([^"]+)"/g))
        expect(imageFor(m[1] ?? ''), `${c.id}: ${m[1] ?? ''}`).toBeDefined();
  });
});
