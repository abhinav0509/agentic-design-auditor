// The Proposal contract (v1.0 §8.1). It is the only thing that crosses from an agent into the
// review layer, and agent output is untrusted, so the schema is strict.
import { describe, expect, it } from 'vitest';
import example from './__fixtures__/proposal.example.json' with { type: 'json' };
import { parseProposal, proposalJsonSchema } from './proposal.ts';

// Deep copy so each test can mutate freely.
const valid = (): Record<string, unknown> => structuredClone(example);
const at = (o: Record<string, unknown>, key: string) => o[key] as Record<string, unknown>;

describe('parseProposal', () => {
  it('accepts the §8.1 example', () => {
    expect(parseProposal(valid()).proposal_id).toBe(example.proposal_id);
  });

  it.each([
    'schema_version',
    'proposal_id',
    'run_id',
    'agent',
    'kind',
    'title',
    'rationale',
    'rule',
    'target',
    'confidence',
    'evidence',
    'base',
    'created_at',
    'expires_at',
  ])('rejects a proposal missing %s', (field) => {
    const p = valid();
    delete p[field];
    expect(() => parseProposal(p)).toThrow();
  });

  it('rejects an unknown schema_version', () => {
    expect(() => parseProposal({ ...valid(), schema_version: '2.0' })).toThrow();
  });

  it.each(['critical', 'blocked', 'LOW', ''])('rejects risk level %j', (level) => {
    const p = valid();
    at(p, 'risk').level = level;
    expect(() => parseProposal(p)).toThrow();
  });

  it.each([-0.01, 1.01, Number.NaN])('rejects confidence %d', (confidence) => {
    expect(() => parseProposal({ ...valid(), confidence })).toThrow();
  });

  it('rejects unknown fields at any level, so an agent cannot smuggle data through', () => {
    expect(() => parseProposal({ ...valid(), status: 'approved' })).toThrow();
    const p = valid();
    at(p, 'risk').override = 'low';
    expect(() => parseProposal(p)).toThrow();
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'not a url'])(
    'rejects page_url %s',
    (page_url) => {
      const p = valid();
      at(p, 'target').page_url = page_url;
      expect(() => parseProposal(p)).toThrow();
    },
  );

  it('rejects a line range that ends before it starts', () => {
    const p = valid();
    at(p, 'target').range = { start_line: 42, end_line: 41 };
    expect(() => parseProposal(p)).toThrow();
  });

  it('rejects expires_at that is not after created_at', () => {
    expect(() => parseProposal({ ...valid(), expires_at: example.created_at })).toThrow();
  });

  it('rejects a content_hash that is not sha256:<64 hex>', () => {
    const p = valid();
    at(p, 'base').content_hash = 'sha256:abc';
    expect(() => parseProposal(p)).toThrow();
  });
});

describe('proposal kinds', () => {
  it.each(['change', 'risk', 'verification'])('a patch requires %s', (field) => {
    const p = valid();
    delete p[field];
    expect(() => parseProposal(p)).toThrow();
  });

  it('a patch must not carry a question', () => {
    expect(() =>
      parseProposal({ ...valid(), question: { text: 'Decorative?', options: [] } }),
    ).toThrow();
  });

  it('needs_input requires a question and carries no change', () => {
    const base = { ...valid(), kind: 'needs_input', change: null, verification: null };
    expect(() => parseProposal({ ...base, question: null })).toThrow();
    const ok = parseProposal({
      ...base,
      question: {
        text: 'Is this image decorative or informative?',
        options: ['Decorative', 'Informative'],
      },
    });
    expect(ok.kind).toBe('needs_input');
    expect(() =>
      parseProposal({ ...base, change: valid().change, question: { text: 'x', options: [] } }),
    ).toThrow();
  });

  it('decline carries neither a change nor a question', () => {
    const decline = {
      ...valid(),
      kind: 'decline',
      change: null,
      verification: null,
      question: null,
    };
    expect(parseProposal(decline).kind).toBe('decline');
    expect(() => parseProposal({ ...decline, change: valid().change })).toThrow();
  });
});

describe('proposalJsonSchema', () => {
  // A changed snapshot is a contract change: review it, and bump schema_version if it breaks consumers.
  it('matches the committed contract snapshot', async () => {
    await expect(JSON.stringify(proposalJsonSchema(), null, 2) + '\n').toMatchFileSnapshot(
      './__snapshots__/proposal.schema.json',
    );
  });
});
