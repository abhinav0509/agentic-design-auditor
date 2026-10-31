// The demo drives the real pipeline end to end with a scripted model; these checks keep it honest.
import { afterAll, describe, expect, it } from 'vitest';
import { closeBrowser, decideOn, listCases, reviseValue, runCase } from './pipeline.ts';

const imageCase = listCases().find((c) => c.rule === 'image-alt')?.id ?? '';

afterAll(closeBrowser);

describe('demo pipeline', { timeout: 60_000 }, () => {
  it('scans, fixes, and lets a reviewer approve', async () => {
    const run = await runCase(imageCase, 'fix');
    expect(run.result.kind).toBe('patch');
    expect(run.proposal?.state).toMatchObject({ status: 'pending', version: 1 });
    expect(run.diff[0]?.after).toMatch(/alt="/);
    const approved = decideOn(run.id, { action: 'approve', key: 'k1', expectedVersion: 1 });
    expect(approved.proposal?.state.status).toBe('approved');
  });

  it('an obeyed injection is blocked by the guard', async () => {
    const run = await runCase(imageCase, 'injection');
    expect(run.result).toMatchObject({ kind: 'blocked', reasons: ['VALUE_UNSAFE'] });
    expect(run.proposal?.state.status).toBe('blocked');
  });

  it('a key on the page is scrubbed from what the model is sent', async () => {
    const run = await runCase(imageCase, 'secret');
    expect(run.prompt).toContain('[REDACTED_SECRET]');
    expect(run.prompt).not.toContain('sk_live_');
  });

  it('a reviewer edit goes back through the guard', async () => {
    const run = await runCase(imageCase, 'fix');
    expect(reviseValue(run.id, '<b>hi</b>')).toEqual({ ok: false, reasons: ['VALUE_UNSAFE'] });
    expect(reviseValue(run.id, 'Ana at the wheel').ok).toBe(true);
  });
});
