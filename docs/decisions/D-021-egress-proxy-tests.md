# D-021: Egress proxy tested in CI against the real Smokescreen binary

- **Date:** 2026-10-30
- **Decision:** The proxy layer of NFR-09 (D-017, D-020) is tested in CI by running Chromium with `chromiumLaunchOptions` (`packages/scanner/src/sandbox.ts`) through a real Smokescreen v0.1.0 process. `pnpm smokescreen:install` downloads the release build and checks it against SHA-256 hashes pinned in `tools/smokescreen/src/install.ts`, not against the release's own `SHA256SUMS`.
- **Test topology (one machine):** "public" is `127.0.0.1` on one port, allow-listed with `--allow-address`; everything else on loopback is private. A small DNS server (`--resolver-address`) answers with TTL 0 and can flip answers. Loopback servers and a UDP sink record every hit, so a test asserts both "nothing arrived" and "the proxy logged a deny".
- **Launch options:** `proxy.server` plus `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`. No explicit `<-loopback>` bypass rule: Playwright already sends loopback through the proxy, and a test pins that.
- **Findings that changed D-017:** `fdaa::/16` needs no extra `--deny-range`; Smokescreen's built-in private class covers `fc00::/7`.
- **Not covered here (still the Fly spike, D-017):** nftables lock for the `scanner` user, raw sockets that skip the proxy, `.internal` names on Fly's real private network, cold start and render timings. Ports are not restricted by Smokescreen; the 80/443 rule is the network layer's job and the in-app check's.
- **Revisit:** when upgrading Smokescreen (bump version and four hashes together) or Playwright (the loopback pin may break).
