// In-memory GitProvider for tests (addendum F.5). Not imported by production code.
import type { GitProvider, PullRequest } from '@beacon/core';
import { createHash } from 'node:crypto';

type Commit = { parent: string | null; files: Map<string, string>; message: string };
type Pr = PullRequest & { head: string; base: string; title: string; body: string };
type Write = 'createCommit' | 'createBranch' | 'openPullRequest';

export class FakeGitProvider implements GitProvider {
  readonly commits = new Map<string, Commit>();
  readonly refs = new Map<string, string>();
  readonly prs: Pr[] = [];
  defaultName: string;
  /** Throws on the nth write (1-based) to simulate a crash, then behaves normally. */
  crashOnWrite: number | null = null;
  private writes = 0;

  constructor(files: Record<string, string>, defaultName = 'main') {
    this.defaultName = defaultName;
    const sha = this.store({
      parent: null,
      files: new Map(Object.entries(files)),
      message: 'init',
    });
    this.refs.set(defaultName, sha);
  }

  /** The commits from a branch's head back to (not including) `base`, oldest first. */
  log(branch: string, base: string): Commit[] {
    const out: Commit[] = [];
    let sha = this.refs.get(branch) ?? null;
    const stop = this.refs.get(base);
    while (sha !== null && sha !== stop) {
      const c = this.commits.get(sha);
      if (!c) break;
      out.unshift(c);
      sha = c.parent;
    }
    return out;
  }

  /** A file's text at a branch's head. */
  file(branch: string, path: string): string | undefined {
    return this.commits.get(this.refs.get(branch) ?? '')?.files.get(path);
  }

  defaultBranch() {
    return Promise.resolve(this.defaultName);
  }

  headSha(branch: string) {
    return Promise.resolve(this.refs.get(branch) ?? null);
  }

  readFile(sha: string, path: string) {
    return Promise.resolve(this.commits.get(sha)?.files.get(path) ?? null);
  }

  createCommit(input: { parent: string; path: string; content: string; message: string }) {
    this.write('createCommit');
    const parent = this.commits.get(input.parent);
    if (!parent) throw new Error(`no commit ${input.parent}`);
    const files = new Map(parent.files).set(input.path, input.content);
    return Promise.resolve(this.store({ parent: input.parent, files, message: input.message }));
  }

  createBranch(name: string, sha: string) {
    this.write('createBranch');
    if (this.refs.has(name)) throw new Error(`reference ${name} already exists`);
    if (!this.commits.has(sha)) throw new Error(`no commit ${sha}`);
    this.refs.set(name, sha);
    return Promise.resolve();
  }

  findPullRequest(head: string) {
    const pr = this.prs.find((p) => p.head === head);
    return Promise.resolve(pr ? { number: pr.number, url: pr.url } : null);
  }

  openPullRequest(input: { head: string; base: string; title: string; body: string }) {
    this.write('openPullRequest');
    if (!this.refs.has(input.head)) throw new Error(`no branch ${input.head}`);
    const number = this.prs.length + 1;
    const pr = { ...input, number, url: `https://github.test/pr/${String(number)}` };
    this.prs.push(pr);
    return Promise.resolve({ number, url: pr.url });
  }

  private write(op: Write) {
    this.writes++;
    if (this.writes === this.crashOnWrite) throw new Error(`crash during ${op}`);
  }

  private store(c: Commit): string {
    const files = JSON.stringify([...c.files].sort());
    const sha = createHash('sha1')
      .update(`${c.parent ?? ''}\n${c.message}\n${files}`)
      .digest('hex');
    this.commits.set(sha, c);
    return sha;
  }
}
