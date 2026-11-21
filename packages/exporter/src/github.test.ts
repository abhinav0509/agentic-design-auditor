// The GitHub adapter (D-052): GitProvider over the REST API with an injected fetch. Tests script the
// API's answers and check every request, so no test reaches GitHub.
import { describe, expect, it } from 'vitest';
import { checkout, GitHubProvider, type Fetch } from './github.ts';

const TOKEN = 'github_pat_TESTTOKEN0123456789';
type Call = { method: string; url: string; body: unknown; auth: string | null };

/** A fetch that answers from a table of "METHOD path" -> [status, json], recording each call. */
function fakeFetch(routes: Record<string, [number, unknown]>) {
  const calls: Call[] = [];
  const fetch: Fetch = (url, init) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      url: u.pathname + u.search,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: headers.get('authorization'),
    });
    const hit = routes[`${method} ${u.pathname}${u.search}`] ?? routes[`${method} ${u.pathname}`];
    const [status, json] = hit ?? [404, { message: 'Not Found' }];
    return Promise.resolve(
      new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { fetch, calls };
}
const R = '/repos/jo/shop';
const gh = (f: Fetch) => new GitHubProvider({ owner: 'jo', repo: 'shop', token: TOKEN, fetch: f });

describe('GitHubProvider', () => {
  it('FR-14: reads the live default branch and a branch head, null when the branch does not exist', async () => {
    const { fetch, calls } = fakeFetch({
      [`GET ${R}`]: [200, { default_branch: 'main' }],
      [`GET ${R}/git/ref/heads/main`]: [200, { object: { sha: 'aaa' } }],
    });
    const git = gh(fetch);

    expect(await git.defaultBranch()).toBe('main');
    expect(await git.headSha('main')).toBe('aaa');
    expect(await git.headSha('beacon/x/y')).toBeNull();
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it('FR-14: a commit is a blob, a tree on the parent’s tree and a commit; no ref moves', async () => {
    const { fetch, calls } = fakeFetch({
      [`POST ${R}/git/blobs`]: [201, { sha: 'blob1' }],
      [`GET ${R}/git/commits/parent1`]: [200, { tree: { sha: 'tree0' } }],
      [`POST ${R}/git/trees`]: [201, { sha: 'tree1' }],
      [`POST ${R}/git/commits`]: [201, { sha: 'commit1' }],
    });

    const sha = await gh(fetch).createCommit({
      parent: 'parent1',
      path: 'about.html',
      content: '<p>hi</p>',
      message: 'Fix alt',
    });

    expect(sha).toBe('commit1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${R}/git/blobs`,
      `GET ${R}/git/commits/parent1`,
      `POST ${R}/git/trees`,
      `POST ${R}/git/commits`,
    ]);
    expect(calls[0]?.body).toEqual({ content: '<p>hi</p>', encoding: 'utf-8' });
    expect(calls[2]?.body).toEqual({
      base_tree: 'tree0',
      tree: [{ path: 'about.html', mode: '100644', type: 'blob', sha: 'blob1' }],
    });
    expect(calls[3]?.body).toEqual({ message: 'Fix alt', tree: 'tree1', parents: ['parent1'] });
    expect(calls.some((c) => c.url.includes('/git/refs'))).toBe(false);
  });

  it('FR-14: creates a branch only as a new ref, and opens or finds the PR', async () => {
    const { fetch, calls } = fakeFetch({
      [`POST ${R}/git/refs`]: [201, {}],
      [`GET ${R}/pulls?head=jo%3Abeacon%2Fab%2Fcd&state=all`]: [
        200,
        [{ number: 7, html_url: 'https://github.com/jo/shop/pull/7' }],
      ],
      [`POST ${R}/pulls`]: [201, { number: 8, html_url: 'https://github.com/jo/shop/pull/8' }],
    });
    const git = gh(fetch);

    await git.createBranch('beacon/ab/cd', 'commit1');
    expect(await git.findPullRequest('beacon/ab/cd')).toEqual({
      number: 7,
      url: 'https://github.com/jo/shop/pull/7',
    });
    expect(
      await git.openPullRequest({ head: 'beacon/ab/cd', base: 'main', title: 'T', body: 'B' }),
    ).toEqual({ number: 8, url: 'https://github.com/jo/shop/pull/8' });
    expect(calls[0]?.body).toEqual({ ref: 'refs/heads/beacon/ab/cd', sha: 'commit1' });
    expect(calls[2]?.body).toEqual({ head: 'beacon/ab/cd', base: 'main', title: 'T', body: 'B' });
  });

  it('NFR-07: an API error names the status and path, never the token', async () => {
    const { fetch } = fakeFetch({
      [`POST ${R}/git/refs`]: [422, { message: 'Reference already exists' }],
    });

    const error = await gh(fetch)
      .createBranch('beacon/ab/cd', 'c')
      .catch((e: unknown) => e);

    expect(String(error)).toMatch(/422.*git\/refs.*Reference already exists/);
    expect(String(error)).not.toContain(TOKEN);
  });

  it('refuses an owner or repo that is not a plain GitHub name', () => {
    for (const [owner, repo] of [
      ['jo/../x', 'shop'],
      ['jo', 'shop?x=1'],
      ['', 'shop'],
    ])
      expect(
        () =>
          new GitHubProvider({
            owner: owner ?? '',
            repo: repo ?? '',
            token: TOKEN,
            fetch: fakeFetch({}).fetch,
          }),
      ).toThrow(/owner|repo/);
  });
});

describe('checkout', () => {
  const tree = (entries: { path: string; type?: string; size?: number; sha?: string }[]) => ({
    [`GET ${R}/git/trees/c1?recursive=1`]: [
      200,
      {
        truncated: false,
        tree: entries.map((e) => ({ type: 'blob', size: 10, sha: `b-${e.path}`, ...e })),
      },
    ] as [number, unknown],
  });
  const blob = (path: string, bytes: Uint8Array): Record<string, [number, unknown]> => ({
    [`GET ${R}/git/blobs/b-${path}`]: [
      200,
      { encoding: 'base64', content: Buffer.from(bytes).toString('base64') },
    ],
  });

  it('FR-14: reads a commit’s files, text as strings for the mapper and images as bytes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { fetch } = fakeFetch({
      ...tree([{ path: 'index.html' }, { path: 'img/a.png' }, { path: 'docs', type: 'tree' }]),
      ...blob('index.html', new TextEncoder().encode('<h1>Hi</h1>')),
      ...blob('img/a.png', png),
    });

    expect(await checkout(gh(fetch), 'c1')).toEqual({
      'index.html': '<h1>Hi</h1>',
      'img/a.png': png,
    });
  });

  it('NFR-05: refuses a checkout over the file or size caps, and a truncated tree', async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ path: `p${String(i)}.html` }));
    expect(
      await checkout(gh(fakeFetch(tree(many)).fetch), 'c1').catch((e: unknown) => String(e)),
    ).toMatch(/500 files/);
    const big = [{ path: 'video.mp4', size: 30_000_000 }];
    expect(
      await checkout(gh(fakeFetch(tree(big)).fetch), 'c1').catch((e: unknown) => String(e)),
    ).toMatch(/MB/);
    const truncated = {
      [`GET ${R}/git/trees/c1?recursive=1`]: [200, { truncated: true, tree: [] }] as [
        number,
        unknown,
      ],
    };
    expect(
      await checkout(gh(fakeFetch(truncated).fetch), 'c1').catch((e: unknown) => String(e)),
    ).toMatch(/truncated/);
  });
});
