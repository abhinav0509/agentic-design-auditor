# D-028: Corpus images drawn in code, and blind cases

- **Date:** 2026-11-01
- **Decision:** every `<img src>` on a corpus page has a real image in `fixtures/corpus/images/`, drawn as SVG in `tools/corpus-images` and rendered with Chromium (`pnpm corpus:images`). `manifest.json` maps each src to its file, media type and subject words (the decorative divider has none). `imageFor(src)` in `@beacon/evals` serves them; the eval's `get_image` returns the finding's real image.
  - **Blind cases:** each image case runs again as `<id>--blind`, where `get_image` fails with "the image could not be loaded". A patch there is a _blind guess_; the gate is 0 (the failing eval that precedes the prompt rule, addendum F.7).
  - **Alt names the subject:** an image fix whose alt mentions any subject word (case-insensitive). A cheap, judge-free quality signal, reported with a Wilson interval.
  - **Replay:** a recorded run writes `fixtures/llm-recordings/run.json` (model, prompt version, scores); the replay test re-runs the recordings and requires the same scores.
- **Context:** the first real run (D-027) saw a 1×1 placeholder, so 17 of 40 cases asked a question and two guessed.
- **Options:** stock photos (licences, size), generated photos (cost, not reproducible), drawn in code.
- **Chosen:** drawn in code: reproducible, licence-free, 228 KB in total, and the subject of each image is known by construction.
- **Consequences:** simple drawings are easier to describe than real photos, so alt quality here is an upper bound. Changing a scene changes `get_image` results and makes the recordings stale until re-recorded.
