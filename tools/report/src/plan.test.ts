import { describe, expect, it } from 'vitest';
import { planReport } from './plan.ts';

describe('planReport', () => {
  it('FR-30: plans a report when the requester’s work email is on the site’s domain', () => {
    expect(
      planReport(['--requested-by', 'jo@acme.com', 'https://acme.com/', 'https://acme.com/about']),
    ).toEqual({
      ok: true,
      plan: {
        requestedBy: 'jo@acme.com',
        siteUrl: 'https://acme.com/',
        urls: ['https://acme.com/', 'https://acme.com/about'],
        orgId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ) as string,
      },
    });
  });

  it('FR-30: the same site always maps to the same org, and different sites to different orgs', () => {
    const org = (url: string) => {
      const r = planReport([
        '--requested-by',
        `jo@${new URL(url).hostname.replace(/^www\./, '')}`,
        url,
      ]);
      return r.ok ? r.plan.orgId : null;
    };
    expect(org('https://acme.com/')).toBe(org('https://acme.com/pricing'));
    expect(org('https://acme.com/')).not.toBe(org('https://other.com/'));
  });

  it.each([
    [[], /usage/i],
    [['https://acme.com/'], /requested-by/i],
    [['--requested-by', 'jo@acme.com'], /at least one url/i],
    [['--requested-by', 'jo@gmail.com', 'https://acme.com/'], /FREE_MAIL/],
    [['--requested-by', 'jo@evil.com', 'https://acme.com/'], /DOMAIN_MISMATCH/],
    [['--requested-by', 'jo@acme.com', 'https://acme.com/', 'https://other.com/'], /same host/i],
    [
      [
        '--requested-by',
        'jo@acme.com',
        ...Array.from({ length: 11 }, (_, i) => `https://acme.com/${String(i)}`),
      ],
      /at most 10/i,
    ],
  ])('FR-30: refuses %j', (argv, error) => {
    const r = planReport(argv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(error);
  });

  it('FR-29: --agent-review asks for the agent review; it is off by default', () => {
    const on = planReport(['--agent-review', '--requested-by', 'jo@acme.com', 'https://acme.com/']);
    const off = planReport(['--requested-by', 'jo@acme.com', 'https://acme.com/']);
    expect(on.ok && on.plan.agentReview).toBe(true);
    expect(off.ok && off.plan.agentReview).toBe(false);
    expect(on.ok && on.plan.urls).toEqual(['https://acme.com/']);
  });
});
