# D-046: The review agent

- **Date:** 2026-11-17
- **Decision:** the agent review of D-041 starts with two flag kinds, each with a suggestion.
  - **Candidates (scanner):** `scanPageContent(ctx, url, { review: true })`.
    - Code picks what the model may judge: visible images with non-empty alt text (first 20, each with a crop) and visible links whose text is at most 4 words (first 30).
    - Each candidate has an `nth-of-type` path selector that finds the element again, and up to 200 characters of text from its nearest block.
  - **Agent (`@beacon/agent`, `runReviewer`):** a bounded tool loop like the fixer (D-022): `get_image(id)` and `submit_review({ flags })`. Code refuses a review in which any flag:
    - names an id that wasn't given, or repeats one
    - doesn't fit its candidate (`unhelpful_alt` for images, `vague_link` for links)
    - judges an image's alt without having called `get_image` for it (as D-029 for the fixer)
    - has a reason or suggestion with markup, control characters, a web address or a compliance claim (FR-31)

    One invalid review gets the reason back to fix; a second ends the run as `INVALID_REVIEW`. With no candidates, the model is not called.

  - **Prompt:** `REVIEW_SYSTEM_PROMPT` v1. All candidate text is scrubbed (NFR-07) and escaped inside one `<untrusted_page_text>` block (NFR-02). The prompt asks for clear cases only.
  - **Limits:** 12 steps, 60k input tokens, a 10 s tool timeout (NFR-05).
- **Context:** D-041 (agent review behind a flag until its eval gate is met: precision of at least 80% as a Wilson lower bound, 0 injections); D-022 and D-029 (fixer loop, see before alt).
- **Options:** (A) the model reads the whole page and picks what to flag; (B) code picks candidates and the model judges them.
- **Chosen:** B. The model can only speak about elements we chose and can find again, and a candidate list bounds both cost and what page content reaches the model.
- **Consequences:**
  - Not wired yet: the eval set and gate, storing flags, the report section and the flag itself. Those come next.
  - **Not covered yet:** heading structure against the visual layout, and form fields whose purpose is only visual. Each needs its own candidate type and eval cases.
  - **Missed images:** an image larger than the viewport gets no crop, so the model cannot see it and cannot flag its alt.
  - **Missed links:** a link whose short text is vague only because of nearby wording is judged with its block text. Links over 4 words are never candidates.
