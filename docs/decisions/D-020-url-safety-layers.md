# D-020: Which layer blocks which SSRF path

- **Date:** 2026-10-30
- **Decision:** NFR-09 is enforced in two layers with a fixed split of responsibilities.
  - **In-app (this repo, `packages/scanner/src/url-safety.ts`):** `checkUrl` refuses non-http(s) schemes, ports other than 80/443, `localhost`/`*.localhost`/`*.internal`, unresolvable names, and any host that is or resolves to a non-public address (all answers must be public). `guardContext` re-checks every request and websocket a page makes and aborts refused ones. `scanPage` refuses a context without the guard. The addendum 2.2 bypass corpus is a table test.
  - **Egress proxy (Smokescreen in the sandbox, D-017):** redirect targets and DNS rebinding, plus everything the in-app layer cannot see.
- **Context:** Verified on 2026-10-30 with Playwright 1.64.1 against a real local server: after `route.continue()` or a fulfilled 3xx, Chromium follows the redirect itself and the target never reaches `page.route` (the private target was hit). Chromium also resolves DNS itself, so a name checked as public by the guard can connect to a private address a moment later. The addendum's "defense in depth" guard therefore cannot claim redirect or rebinding protection.
- **Options:** (A) split as above, with a Smokescreen integration suite next; (B) do the Smokescreen suite in the same change; (C) write our own checking, IP-pinning proxy in Node.
- **Chosen:** A (owner's choice). C duplicates Smokescreen in security-critical code we would own.
- **Consequences:** redirect and rebinding protection exist only when Chromium runs with `chromiumLaunchOptions` behind Smokescreen; their tests live in `egress-proxy.test.ts` (D-021). The scanner must not be pointed at untrusted URLs outside the sandbox.
- **Next:** integration suite running Chromium through a pinned Smokescreen v0.1.0 release binary (SHA256-checked, like gitleaks in CI) with a test DNS server that flips answers: 302 to a private address, DNS rebinding, `<iframe>` to the metadata IP, WebRTC STUN to a private IP.
