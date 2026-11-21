# D-052: The GitHub adapter

- **Date:** 2026-11-21
- **Decision:** `GitHubProvider` (`@beacon/exporter`) implements the `GitProvider` port (D-040) over the GitHub REST API with an injected `fetch` and no SDK. `checkout(git, sha)` reads a commit's files for the mapper and verifier.
  - **Calls:**
    - default branch: `GET /repos/{o}/{r}`, looked up live
    - heads: `GET git/ref/heads/…` (404 means the branch does not exist)
    - commits: blob → the parent's tree → a new tree → a commit, with no ref moved
    - branches: `POST git/refs`, which only creates and fails with 422 if the ref exists
    - PRs: find by `head` (`state=all`), or open one
  - **Checkout:** a recursive tree, then each blob. Text files (`html`, `css`, `js`, `svg`, …) come back as strings, the rest as bytes. Refused over 500 files or 20 MB, or when GitHub truncates the tree. Nothing is run (D-008).
  - **Token:** only in the `Authorization` header. An error names the status, method, path and GitHub's message, never the token. Owner and repo must be plain GitHub names.
- **Context:** the demo flow; the GitHub App (addendum 2.6) is not built.
- **Options:** (A) Octokit; (B) `fetch` against the documented endpoints.
- **Chosen:** B. No new dependency for seven calls, and tests script every request and answer without touching GitHub.
- **Consequences:**
  - **Token for now:** until the GitHub App exists, the token is a fine-grained one limited to the demo repo (Contents and Pull requests: read and write), kept in `.env.local`. With the App, installation tokens replace it behind the same constructor.
  - **One file per commit (D-040),** which the fixer's single-file proposals already fit.
  - **No pagination of `pulls`;** a `head` filter returns at most one PR.
