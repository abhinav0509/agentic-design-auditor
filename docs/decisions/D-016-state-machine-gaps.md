# D-016: State machine gaps filled on Day 3

- **Date:** 2026-10-29
- **Decision:** Three additions to addendum §1.3, approved before implementation:
  1. `awaiting_input → stale` and `awaiting_input → expired`. A question can wait too long, or its file can change while it waits.
  2. `answered` is terminal. The answer creates a new attempt that supersedes it, so nothing more happens to the old proposal.
  3. Every transition increments `version`, including system ones such as expiry, so an expected-version check sees any change.
- **Context:** The addendum's table covered staleness and expiry only for `pending`, and gave `answered` no outgoing rows without calling it terminal.
- **Not yet covered:** creating a proposal writes no event yet. That arrives with the DB layer, where creation and its event are written in one transaction.
- **Revisit:** when the answer flow is built (Day 4+), in case `answered` needs a link to the new attempt beyond `supersedes_id`.
