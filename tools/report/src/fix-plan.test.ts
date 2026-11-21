import { describe, expect, it } from 'vitest';
import { planFixRun } from './fix-plan.ts';

describe('planFixRun', () => {
  it('FR-14: plans a fix run on the repo’s GitHub Pages site, which the repo itself serves', () => {
    const r = planFixRun(['--repo', 'jo/shop', 'index.html', 'about.html']);

    expect(r).toEqual({
      ok: true,
      plan: {
        owner: 'jo',
        repo: 'shop',
        siteUrl: 'https://jo.github.io/shop/',
        urls: ['https://jo.github.io/shop/index.html', 'https://jo.github.io/shop/about.html'],
        orgId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4/) as string,
        requestedBy: 'github:jo/shop',
      },
    });
  });

  it('FR-14: with no pages, the site’s home page; --agent-review adds the review', () => {
    const r = planFixRun(['--agent-review', '--repo', 'jo/shop']);

    expect(r.ok && r.plan.urls).toEqual(['https://jo.github.io/shop/']);
    expect(r.ok && r.plan.agentReview).toBe(true);
  });

  it.each([
    [[], /usage/i],
    [['--repo', 'jo'], /owner\/repo/],
    [['--repo', 'jo/../x'], /owner\/repo/],
    [['--repo', 'jo/shop', 'https://evil.test/x.html'], /path/i],
    [['--repo', 'jo/shop', '../secrets.html'], /path/i],
    [
      ['--repo', 'jo/shop', ...Array.from({ length: 11 }, (_, i) => `p${String(i)}.html`)],
      /at most 10/,
    ],
  ])('refuses %j', (argv, error) => {
    const r = planFixRun(argv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(error);
  });
});
