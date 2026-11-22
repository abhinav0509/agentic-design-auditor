# Beacon roadmap and status

The working plan agreed with the owner on 2026-11-22, kept current as work lands. The requirement IDs
are those in `requirements.yaml`; the phases come from v1.0 §17 and the addendum.

| Milestone                | Scope                                                                                                                                                                                                                                                          | Needs the owner                                                         | Status              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------- |
| M1 Phase 1 code complete | FR-28 kill switch, FR-12 low-risk bulk approve, FR-15 undo, FR-24 edit then approve, NFR-10 and FR-26 audit export with verifiable chain, FR-04 and FR-04a ownership proofs, FR-03 site registration, NFR-04 performance test, NFR-11 tag, NFR-17 supply chain | No                                                                      | In progress         |
| M2 Usable by others      | FR-01 sign-in and organisations, hosted web app, FR-02 GitHub App                                                                                                                                                                                              | Host, database, GitHub OAuth app and GitHub App on the owner's accounts | Waiting on accounts |
| M3 Phase 1 exit          | Three real sites end to end; acceptance and edit rates; case study draft                                                                                                                                                                                       | Three pilot sites                                                       | Not started         |
| M4 Phase 2 private beta  | FR-18 contrast and headings, FR-20 autonomy, FR-19 notifications, sitemap crawl, re-propose, eval corpus v1, WordPress connection                                                                                                                              | Email and Slack accounts; go-ahead on WordPress writes                  | Not started         |
| M5 Phase 3 public launch | FR-22 billing, FR-21 scheduled re-scans, teams and roles, onboarding, public limits pages, public eval dashboard, NFR-15 retention and DSAR, runbooks, backup and restore test, load test                                                                      | Stripe, a domain, an external pen test (NFR-14)                         | Not started         |
| M6 Review Kit package    | FR-23                                                                                                                                                                                                                                                          | An npm account                                                          | Not started         |

## Done before this plan

The engine end to end (scan, map, fix, verify, review, approve, PR), the URL-only report with
verified fix previews, the gated agent review, real-model evals, the reviewer page, and the demo on
`abhinav0509/beacon-demo-shop`. Phase 1 coverage at the start of the plan: 26 of 39 requirements.

## Progress log

- 2026-11-22 FR-28 kill switch (D-057).
