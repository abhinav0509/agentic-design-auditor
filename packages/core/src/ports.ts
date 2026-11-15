// Injected effects (conventions): domain code never reads the time or makes ids by itself.
export type Clock = { now(): Date };
export type IdGen = { uuid(): string };

export type PullRequest = { number: number; url: string };

/**
 * One repository through the GitHub App (v1.0 §7.3). Writes create commits and refs only; the
 * exporter decides which refs may be written (NFR-01), so no method here can move an existing ref.
 */
export type GitProvider = {
  /** The repository's default branch, looked up live on every call (addendum 2.6). */
  defaultBranch(): Promise<string>;
  /** The commit a branch points at, or null when the branch does not exist. */
  headSha(branch: string): Promise<string | null>;
  /** A file's text at a commit, or null when it does not exist there. */
  readFile(sha: string, path: string): Promise<string | null>;
  /** A commit with one file changed, on top of `parent`. No ref moves. */
  createCommit(input: {
    parent: string;
    path: string;
    content: string;
    message: string;
  }): Promise<string>;
  /** Creates a new branch at `sha`. Fails if the branch exists. */
  createBranch(name: string, sha: string): Promise<void>;
  findPullRequest(head: string): Promise<PullRequest | null>;
  openPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<PullRequest>;
};
