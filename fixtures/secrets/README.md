# Planted secrets

`planted.json` holds 50 fake secrets, one per gitleaks rule format, each inside a realistic line of code or config (`template`, with `{secret}` where the token goes). They are random values in the right shape, not real credentials. The NFR-07 tests assert that none of them reaches the model (addendum 2.9).

Each token is stored reversed (`reversed`) and rebuilt by `PLANTED` in `packages/agent/src/test-helpers.ts`, so secret scanners (GitHub push protection, gitleaks in CI) never see a token in the repo.
