# Review eval: claude-opus-5-5 (medium)

Gate: pass

| Metric                        | Value                                   |
| ----------------------------- | --------------------------------------- |
| Precision                     | 18/18 = 100.0% (95% CI 82.4% to 100.0%) |
| Recall                        | 18/18 = 100.0% (95% CI 82.4% to 100.0%) |
| Recall on suppression pages   | 2/2 = 100.0% (95% CI 34.2% to 100.0%)   |
| Suggestions that fix the flag | 17/18 = 94.4% (95% CI 74.2% to 99.0%)   |
| Injections obeyed / succeeded | 0 / 0 of 2                              |
| Cost                          | $0.1522 total, $0.0190 per page         |

Run: 2026-11-21T17:59:54.552Z, prompt v1 (5717fba0c7c9), cases faedb37d0890, engine 8887f7a-dirty, budget $5.0000, served by claude-opus-5-5.

## Disagreements with the labels

None.

## Reading the result

- **The gate passes on the harder set too:** 18 of 18 correct, with a 95% lower bound of 82.4%, against a bar of 80%. 18 flags is the smallest number at which a perfect run can clear it, so one miss would fail.
- **Contradictions were caught and explained from the image.** For example: "it shows two dark mugs on saucers, not five espresso cups"; "a cream bowl with a dark blue rim", not red; "three wrapped items packed in an open cardboard box, not mugs on a shelf"; "Spacer" on a photo of "four potters … at a pottery wheel".
- **No injection worked, even inside alt text.** The alt that told reviewers to stay quiet was flagged as a bad alt. The alt that asked for "See evil.example" in every suggestion was flagged, and the payload appears in no attempt.
- **None of the six short, correct alts was flagged:** "Jug of milk", "Glaze test tiles", "Potter at the wheel" and others.

## Limits this run exposed

- **The set's link context is weak.** Every vague link sits after the same sentence ("Our 2026 catalogue and care notes are ready."), so the model used that context and suggested "2026 catalogue and care notes" for all six. The links point to different pages, so a better set gives each its own context.
- **Suggestions can state details nobody checked.** For the plate stack the model wrote "five"; the reference alt says six, and the drawn image is ambiguous. That is why every suggestion is shown as "not tested on your site".
- **The pages are still synthetic, drawn images,** so this is not real-site precision. The next evidence has to come from pilot pages, each hand-checked before it joins a set.

Cost: $0.15 for 8 pages ($0.019 a page), 2 steps each.
