# D-050: Fix evidence is what assistive technology announces

- **Date:** 2026-11-21
- **Decision:** a proposed fix carries evidence of what it changes for the person using the page, not only for the scanner.
  - **Verifier (`verify(…, { evidence: true })`, opt-in so the plain result is unchanged):**
    - Collects the target element's accessibility-tree entry from Playwright's `ariaSnapshot()` in the before and after renders, for example `- img` → `- img "Potter shaping a bowl on a wheel"`, or `- textbox` → `- textbox "Email address"`. For the document (`html-has-lang`) it is the declared language: `Page language: not set` → `Page language: en`.
    - Returns a PNG crop of the element when it fits the viewport.
    - An element that is not on the page gives no evidence, so an unreproduced finding is still a fast `UNMAPPED_LOCAL_MISMATCH`.
  - **Proposal:** the crop goes to the blob store, and its ref becomes the contract's existing `evidence.after_screenshot` through `buildProposal({ screenshots })`. Refs are checked. The announced text goes to the new `proposals.announced_before` and `announced_after` columns (migration `0013`), outside the §8.1 contract.
  - **Fix job:** asks for evidence, stores the crop when it has a blob store (`FixRunDeps.blobs`), and saves the announced text with the proposal.
- **Context:** FR-10 (the review shows the change), the portfolio goal (a fix anyone can see working), D-031 (verifier), D-042 (blob store).
- **Options:** (A) before/after screenshots; (B) what assistive technology gets, plus one crop to point at the element.
- **Chosen:** B. An alt or label fix changes no pixel, so before/after screenshots would look identical. The accessibility tree is what actually changes, and it is what a screen reader announces.
- **Consequences:**
  - `before_screenshot` stays null, since a before crop of an attribute fix shows nothing new.
  - `ariaSnapshot` output can change wording between Playwright versions. The verifier tests pin it, so an upgrade that changes it fails loudly.
