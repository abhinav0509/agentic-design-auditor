# D-054: The operator fix flow and the report's proposed fixes

- **Date:** 2026-11-21
- **Decision:** `pnpm fix` makes the whole product path one operator can run and anyone can watch.
  - **`pnpm fix scan [--agent-review] --repo <owner/repo> [page path …]`:**
    1. **Plan:** `planFixRun` takes the site to be the repo's GitHub Pages project site, `https://<owner>.github.io/<repo>/`, with up to 10 page paths inside it.
    2. **Ownership:** the CLI checks that `GITHUB_TOKEN` can push to the repo. The repo serves the site, so push access proves control of it, in place of FR-30's email rule, which shared hosts like `github.io` can never satisfy.
    3. **Checkout:** the default branch head is read through the GitHub adapter (D-052).
    4. **Scan, then fix:** the scan runs in the sandbox. `runReport`'s fix step records the repo in `site_connections` (a reference to the token's location, never the token), then runs the fixer on the checkout, with the mapper given the site's base path.
    5. **Output:** the report link and numbered fixes.
  - **`pnpm fix approve <link> all|1 2 …`:** the operator (`BEACON_OPERATOR_EMAIL`) approves waiting fixes through `decideProposal` (D-051). Keys are per proposal version, so repeating the command replays.
  - **`pnpm fix export <link>`:** `exportRun` (D-053) with the repo from `site_connections`, giving one verified PR.
  - **Report:** a "Fixes Beacon proposes" section above the findings. Each fix shows:
    - its status in words ("Waiting for approval", "In pull request #n" with the link, "Did not pass verification", …) and its risk
    - "What a screen reader announces", before and after (D-050), and the crop
    - the rationale, and the diff in a `<details>`
    - Everything is escaped. axe still reports zero violations in light and dark with every diff open. The share link serves proposal crops too.
  - **Mapper:** `siteUrl` strips a project site's path prefix. A URL outside the site maps to no file.
  - **Shared checks:** the sandbox proxy and the review gate moved to `tools/report/src/operator.ts`, so every command applies the same checks.
- **Context:** the portfolio goal (a fix anyone can watch); D-050 to D-053; the owner chose an operator approver and a demo repo created with `gh` (2026-11-21).
- **Options:** ownership for a Pages site by (A) the email rule, (B) push access to the serving repo, (C) a verification file.
- **Chosen:** B. It is the same fact the exporter needs anyway, and the site is that repo's output by construction.
- **Consequences:**
  - **Only `owner.github.io/repo`:** custom domains and other hosts need FR-04a's proofs.
  - **Inline approval:** approval happens in the terminal until the review UI exists. The report shows status but has no buttons yet.
  - **Demo repo:** `abhinav0509/beacon-demo-shop`, with three planted issues (no page language, a photo without alt, an unlabelled field).
