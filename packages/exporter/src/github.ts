import type { GitProvider, PullRequest } from '@beacon/core';
export type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
export class GitHubProvider implements GitProvider {
  constructor(_o: { owner: string; repo: string; token: string; fetch?: Fetch }) {}
  defaultBranch(): Promise<string> {
    return Promise.reject(new Error('not implemented'));
  }
  headSha(_b: string): Promise<string | null> {
    return Promise.reject(new Error('not implemented'));
  }
  readFile(_s: string, _p: string): Promise<string | null> {
    return Promise.reject(new Error('not implemented'));
  }
  createCommit(_i: {
    parent: string;
    path: string;
    content: string;
    message: string;
  }): Promise<string> {
    return Promise.reject(new Error('not implemented'));
  }
  createBranch(_n: string, _s: string): Promise<void> {
    return Promise.reject(new Error('not implemented'));
  }
  findPullRequest(_h: string): Promise<PullRequest | null> {
    return Promise.reject(new Error('not implemented'));
  }
  openPullRequest(_i: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<PullRequest> {
    return Promise.reject(new Error('not implemented'));
  }
}
export function checkout(
  _g: GitHubProvider,
  _sha: string,
): Promise<Record<string, string | Uint8Array>> {
  return Promise.reject(new Error('not implemented'));
}
