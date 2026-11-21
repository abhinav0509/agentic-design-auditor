// GitProvider over the GitHub REST API (D-052), with an injected fetch and no SDK. The token goes in
// the Authorization header only and never into an error. This adapter can create commits, a new ref
// and a PR; it cannot move an existing ref, and which refs may be written is the exporter's decision
// (NFR-01, D-040). Until the GitHub App exists, the token is a fine-grained one limited to one repo.
import type { GitProvider, PullRequest } from '@beacon/core';

export type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const API = 'https://api.github.com';
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export class GitHubProvider implements GitProvider {
  private readonly base: string;
  private readonly token: string;
  private readonly fetch: Fetch;
  readonly owner: string;

  constructor(options: { owner: string; repo: string; token: string; fetch?: Fetch }) {
    if (!NAME.test(options.owner) || options.owner.includes('..'))
      throw new Error('owner must be a plain GitHub name');
    if (!NAME.test(options.repo) || options.repo.includes('..'))
      throw new Error('repo must be a plain GitHub name');
    this.owner = options.owner;
    this.base = `/repos/${options.owner}/${options.repo}`;
    this.token = options.token;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  /** One API call. Returns null on 404 when `missing` allows it; any other failure throws. */
  async call<T>(
    method: string,
    path: string,
    body?: unknown,
    missing: 'null' | 'throw' = 'throw',
  ): Promise<T | null> {
    const res = await this.fetch(`${API}${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 404 && missing === 'null') return null;
    if (!res.ok) {
      const detail = ((await res.json().catch(() => ({}))) as { message?: unknown }).message;
      throw new Error(
        `GitHub ${String(res.status)} on ${method} ${this.base}${path.split('?')[0] ?? ''}${
          typeof detail === 'string' ? `: ${detail.slice(0, 200)}` : ''
        }`,
      );
    }
    return (await res.json()) as T;
  }

  private async must<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.call<T>(method, path, body)) as T;
  }

  async defaultBranch(): Promise<string> {
    return (await this.must<{ default_branch: string }>('GET', '')).default_branch;
  }

  async headSha(branch: string): Promise<string | null> {
    const ref = await this.call<{ object: { sha: string } }>(
      'GET',
      `/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,
      undefined,
      'null',
    );
    return ref?.object.sha ?? null;
  }

  async readFile(sha: string, path: string): Promise<string | null> {
    const file = await this.call<{ encoding: string; content: string }>(
      'GET',
      `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(sha)}`,
      undefined,
      'null',
    );
    if (!file) return null;
    return Buffer.from(file.content, 'base64').toString('utf8');
  }

  async createCommit(input: {
    parent: string;
    path: string;
    content: string;
    message: string;
  }): Promise<string> {
    const blob = await this.must<{ sha: string }>('POST', '/git/blobs', {
      content: input.content,
      encoding: 'utf-8',
    });
    const parent = await this.must<{ tree: { sha: string } }>(
      'GET',
      `/git/commits/${encodeURIComponent(input.parent)}`,
    );
    const tree = await this.must<{ sha: string }>('POST', '/git/trees', {
      base_tree: parent.tree.sha,
      tree: [{ path: input.path, mode: '100644', type: 'blob', sha: blob.sha }],
    });
    const commit = await this.must<{ sha: string }>('POST', '/git/commits', {
      message: input.message,
      tree: tree.sha,
      parents: [input.parent],
    });
    return commit.sha;
  }

  async createBranch(name: string, sha: string): Promise<void> {
    // POST /git/refs only creates; it fails with 422 when the ref exists, so no ref ever moves.
    await this.must('POST', '/git/refs', { ref: `refs/heads/${name}`, sha });
  }

  async findPullRequest(head: string): Promise<PullRequest | null> {
    const prs = await this.must<{ number: number; html_url: string }[]>(
      'GET',
      `/pulls?head=${encodeURIComponent(`${this.owner}:${head}`)}&state=all`,
    );
    const pr = prs[0];
    return pr ? { number: pr.number, url: pr.html_url } : null;
  }

  async openPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<PullRequest> {
    const pr = await this.must<{ number: number; html_url: string }>('POST', '/pulls', input);
    return { number: pr.number, url: pr.html_url };
  }
}

const MAX_FILES = 500;
const MAX_BYTES = 20 * 1024 * 1024;
const TEXT = /\.(html?|css|js|mjs|json|svg|txt|xml|md|webmanifest)$/i;

/**
 * A commit's files for the mapper and verifier (D-008: nothing is ever run): text files as strings,
 * everything else as bytes. Refused over 500 files or 20 MB, or when GitHub truncates the tree.
 */
export async function checkout(
  git: GitHubProvider,
  sha: string,
): Promise<Record<string, string | Uint8Array>> {
  const tree = await git.call<{
    truncated: boolean;
    tree: { path: string; type: string; size?: number; sha: string }[];
  }>('GET', `/git/trees/${encodeURIComponent(sha)}?recursive=1`);
  if (!tree) throw new Error(`no tree for ${sha}`);
  if (tree.truncated) throw new Error('the repository tree is truncated; too large to check out');
  const blobs = tree.tree.filter((e) => e.type === 'blob');
  if (blobs.length > MAX_FILES)
    throw new Error(
      `the repository has ${String(blobs.length)} files; the limit is ${String(MAX_FILES)} files`,
    );
  const bytes = blobs.reduce((n, e) => n + (e.size ?? 0), 0);
  if (bytes > MAX_BYTES)
    throw new Error(`the repository is ${String(Math.round(bytes / 1e6))} MB; the limit is 20 MB`);

  const files: Record<string, string | Uint8Array> = {};
  for (const e of blobs) {
    const blob = await git.call<{ content: string }>('GET', `/git/blobs/${e.sha}`);
    const data = new Uint8Array(Buffer.from(blob?.content ?? '', 'base64'));
    files[e.path] = TEXT.test(e.path) ? new TextDecoder().decode(data) : data;
  }
  return files;
}
