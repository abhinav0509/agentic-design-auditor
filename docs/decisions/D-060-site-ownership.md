# D-060: Registering a site and proving control of it

- **Date:** 2026-11-22
- **Decision:** a site can prove control itself (FR-03, FR-04, FR-04a, addendum 2.1), alongside the work-email rule (FR-30) and push access to a GitHub Pages repo (D-054).
  - **Register (`pnpm site add <url>`):** `registerSite` (idempotent by base URL) and `issueOwnershipToken`. A site keeps one `bv_…` token until it is proven. The command prints the three ways to prove control.
  - **Prove (`verifyOwnership`, scanner):** checked in this order:
    1. a DNS TXT record `beacon-verify=<token>` (no request to the site)
    2. `<meta name="beacon-verification" content="<token>">` on the home page
    3. `/.well-known/beacon-verification.txt` containing the token

    The page and file fetches pass `checkUrl` and run in the guarded browser context, so a site cannot use verification to reach a private address (NFR-09, tested). Tokens must look like Beacon tokens.

  - **Record and freshness:** `pnpm site verify <url>` runs the check in the sandbox (Smokescreen plus the in-app guard) and records `ownership_verified_at`. `ownershipFresh` holds for 30 days (addendum 2.1).
  - **Scan (`pnpm report --site-proven …`):** the email-domain rule is replaced by the site's own proof, which must be fresh, or the command stops and says how to prove it. The requester's email is still recorded on the run.
- **Context:** FR-03, FR-04, FR-04a, M1. Prospects whose email does not match their site (agencies, freelancers, free-mail owners) need a way in.
- **Options:** which proofs to accept. All three in the addendum, in cost order.
- **Chosen:** all three, DNS first.
- **Consequences:**
  - **Home page only:** the meta tag is read from the home page only.
  - **No automatic re-check:** re-verification is manual until scheduled scans (FR-21) re-check before running.
  - **One token per site:** the token does not rotate until the site is proven.
