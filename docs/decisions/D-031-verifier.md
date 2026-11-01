# D-031: The verifier

- **Date:** 2026-11-01
- **Decision:** `@beacon/verifier`'s `verify(browser, { files, page, finding, patch })` follows addendum A.3.
  - **Serving:** the checkout is served from memory on an unresolvable origin by request routing: static files only, never a build or a repo script (D-008). Every other origin is aborted and service workers are blocked.
  - **Rendering:** 1280×800 viewport, `prefers-reduced-motion`, animations disabled for screenshots, a fixed clock (2026-01-01), full-page screenshots.
  - **Reproduce:** the finding (axe rule + target selector) must appear on the unpatched render, or the result is `UNMAPPED_LOCAL_MISMATCH` (new error code): report only, no patch.
  - **Re-scan:** every axe rule, not only the MVP three. The target must be gone, and no (rule, target) pair may occur more often than before. Pairs ignore the element's HTML, so the patched element's changed markup is not counted as new.
  - **Visual diff:** the unpatched page is rendered twice; 16×16 tiles holding any differing pixel are masked as noise. The ratio of changed pixels outside the mask is reported as `visualDiffRatio`, or 0 when it is within `noise × k` (k = 3). The existing risk classifier raises risk to high above 1%, which together gives A.3's `max(threshold, noise × k)` without a second threshold. Above a 20% hard cap the verification fails.
- **Context:** FR-08 (proposals pass guard and verifier before ready); v1.0 §9.4; addendum A.3.
- **Options:** a pixel-diff dependency (pixelmatch + pngjs) vs comparing in the browser's canvas.
- **Chosen:** canvas in the same Chromium: no new dependency, and the screenshots come from that browser anyway.
- **Consequences:** k, the cap and the tile size are first guesses until calibrated on real sites. Exact pixel equality relies on the same machine rendering all three shots, which the verifier always does. Requests are blocked by routing; network-level isolation of the verifier (the scanner's egress proxy) is a deployment concern for the worker. Wiring into the proposal flow comes with the proposal builder.
