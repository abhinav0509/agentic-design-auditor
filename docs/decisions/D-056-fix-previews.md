# D-056: Fix previews from the URL alone

- **Date:** 2026-11-22
- **Decision:** the URL-only report shows the fix Beacon would make for each fixable finding, made and checked on a copy of the live page, with no access to the client's code.
  - **Why it comes first:** prospects give a URL, not a repo (the owner, repeatedly). The free report has to prove value on its own. The repo/PR cycle (D-050 to D-055) is the paid step after the client agrees.
  - **Worker (`previewFixes`):** for each fix job of the run, a one-page checkout built from the live page:
    - the HTML as served, under the file name the mapper expects for its URL
    - for an image, the scan's crop of it under the image's path, so the fixer can see it
    - the served HTML's SHA-1 standing in for the commit

    The unchanged fix job then runs (mapper, fixer, verifier with evidence), and the result is saved as a preview, not a proposal.

  - **Image type:** the fixer's image tool reads the type from the bytes (PNG, JPEG, GIF, WebP signatures), not the extension, because a crop is a PNG whatever the `src` says.
  - **Storage:** `fix_previews` (migration `0015`): rule, title, rationale, the element now and with the fix, what a screen reader announces before and after, whether the verifier passed, and the crop. Tenant-isolated, seeded for the RLS matrix, one per finding. Previews cannot be approved or exported: they are not proposals.
  - **Report:** "Fixes Beacon would make", right after the summary. Each fix shows "Checked on a copy of the live page" (or "Did not pass the check"), the announced before/after, the element now and with the fix (escaped), and the reason. The section says applying them needs access to the site's code. Zero axe violations in light and dark, and no claims.
  - **Operator:** `pnpm report --preview-fixes …` for a prospect proven by work email, and `pnpm fix scan --preview-only --repo …` for a Pages site we control (push access proves it, and the checkout is not used).
- **Found by the first live run:**
  - **The failure:** the model's page-language rationale claimed compliance. Proposal parsing threw (FR-31), the job failed twice, and a good fix was lost.
  - **The fix:** the fixer loop now checks the draft's text first and sends the claim phrases back to rephrase, with one retry, then `INVALID_PROPOSAL`. It is an ordinary invalid draft, not an exception.
  - **The re-run:** previews for all three demo issues (alt text, field name, page language), all checked, for $0.06 plus $0.01.
- **Context:** D-041 (URL-only report), D-050 (evidence), the market note in memory (no repo access first).
- **Options:** (A) generic suggestions only (the agent review, D-046); (B) the real fixer and verifier on a copy of the live page.
- **Chosen:** B. It shows the exact change and what it does for a screen reader, checked, which is the most convincing thing the free report can show. With repo access, the same fixes become reviewed PRs.
- **Consequences:**
  - **Static pages only:** the copy is the page as served. A page whose HTML is rendered by JavaScript after load differs from the served HTML; the mapper then calls it not served as-is, and no preview is made.
  - **Not the source fix:** a preview is a fix to the served page, not to source code. On built sites the real fix lives in templates or a CMS, which is why applying it needs the code (or a CMS connection, still to decide).
  - **Cost:** each preview costs a fixer run (about $0.02 a finding on Opus 5.5). Keep `--preview-fixes` an explicit operator choice.
