# D-017: Scanner sandbox hosting and egress control

- **Date:** 2026-10-29
- **Status:** Accepted (signed off by the owner on 2026-10-29). The spike checks below are still pending; a failed nftables check switches to the fallback.
- **Decision:** Run each scan or verify job in its own **ephemeral Fly.io Machine** (a Firecracker microVM, destroyed after the job). All browser traffic goes through **Smokescreen** running inside the same VM, and is enforced at the network layer: only the proxy's user may make outbound connections. **Fallback:** Cloud Run jobs with Direct VPC egress and a deny-all firewall.
- **Context:** Open question v1.0 §19.2 #1. Requirements: NFR-09 (SSRF protection, sandbox), D-008 (never run customer code), addendum 2.2 (egress allowlisting proxy, DNS pinning, network-layer enforcement).

## Cost of one 10-page scan

Assumption to measure in the spike: about 40 renders (10 scan + about 30 verify renders, at 3 per proposal) × about 9 s ≈ 360 s on 2 vCPU / 4 GB.

| Option                      | Unit price (source)                                                                 | ≈ per scan   | Fixed monthly cost                                  |
| --------------------------- | ----------------------------------------------------------------------------------- | ------------ | --------------------------------------------------- |
| Fly performance-1x 2 GB     | $33.00 / 30 days, per-second billing                                                | $0.005       | none (stopped machines: rootfs $0.15/GB/mo)         |
| Fly performance-2x 4 GB     | $66.00 / 30 days                                                                    | $0.009       | none                                                |
| AWS Fargate ARM (us-east-1) | $0.0000089944 vCPU-s, $0.0000009889 GB-s, 1-min minimum                             | $0.008       | NAT gateway (fixed hourly, roughly $30+/mo; verify) |
| AWS Fargate x86             | $0.000011244 vCPU-s, $0.000001235 GB-s                                              | $0.010       | same                                                |
| Cloud Run jobs (Tier 1)     | $0.000018–0.000024 vCPU-s, $0.0000020–0.0000025 GiB-s (sources disagree, see below) | $0.016–0.021 | none; free tier ≈ 333 such scans/month              |

**Conclusion:** compute is about one cent per scan everywhere, so model tokens will dominate cost (NFR-05). The choice therefore rests on isolation and on how egress can be enforced, not on price.

## Isolation and egress

|                                      | Fly Machines                                                              | Cloud Run jobs                                                                     | Fargate                                                  |
| ------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Per-job isolation                    | Firecracker microVM, own kernel                                           | gVisor or microVM (gen2)                                                           | Firecracker microVM                                      |
| Network-layer egress lock            | nftables inside the VM (root in own kernel). **Must verify.**             | VPC firewall: deny all except the proxy (managed, strong)                          | Security groups (strong), but no `NET_ADMIN` in the task |
| Proxy placement                      | Same VM, separate user                                                    | Separate service: the firewall can't tell containers in one job apart              | Separate task                                            |
| Metadata or credential endpoint risk | No cloud IAM metadata; Fly private network (`fdaa::/16`) must be isolated | Metadata server always reachable: give the job a **no-permission** service account | Task-role endpoint: give it a **no-permission** role     |
| Ops for one builder                  | Lowest: Machines API, create, run, auto-destroy                           | Medium: VPC, connector or Direct egress, firewall                                  | Highest: VPC, NAT, security groups, ECS                  |

## Egress design (whichever host)

1. Chromium runs as user `scanner` with `--proxy-server=127.0.0.1:4750` and WebRTC restricted to proxied UDP only (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`), so WebRTC can't reach internal IPs directly.
2. nftables (Fly) or the firewall (Cloud Run): the `scanner` user may connect only to `127.0.0.1:4750`. Only the `smokescreen` user may reach the internet, and only on 80/443.
3. **Smokescreen** (Stripe, MIT, last commit 2026-10-28):
   - **DNS:** it resolves names itself and connects to the exact IP it checked (`net.DialTimeout(network, d.ResolvedAddr.String(), …)`), so DNS rebinding can't redirect it.
   - **Built-in deny classes:** private ranges, CGNAT, IPv6-embedded IPv4, not-global-unicast (which covers link-local such as `169.254.169.254`) and self-connections.
   - **Extra:** we add `fdaa::/16` (Fly private network) to its deny list.
4. The VM has no Beacon secrets: no GitHub token, model key or DB credentials. It receives a URL list and returns results through a signed callback.

## Spike: acceptance checks (these become Phase 1 integration tests)

Run from inside the sandbox against a hostile test page. Every one of these must be **blocked**, and Smokescreen must log each denial:

- [ ] `fetch('http://169.254.169.254/')`, `http://[fd00::1]/`, `http://10.0.0.1/`, `http://127.0.0.1:4750/` (the proxy itself)
- [ ] Another Beacon app's `.internal` name on Fly's private network
- [ ] A 302 redirect to a private address
- [ ] DNS rebinding (a test domain that answers public, then private)
- [ ] WebRTC STUN to a private IP
- [ ] Decimal, octal and hex IP forms, and `localhost.` with a trailing dot
- [ ] Direct connection by the `scanner` user that skips the proxy (raw socket to `1.1.1.1:443`)

Also measure: render time per page (to check the 360 s assumption), cold start for a Machine, and peak memory.
**If the nftables user lock doesn't work on Fly, switch to the fallback (Cloud Run jobs).**

## Options not chosen

- **Fargate:** strong isolation, but no `NET_ADMIN`, so the proxy must be a separate task, and the NAT gateway adds a fixed monthly cost before the first customer.
- **Cloud Run first:** strongest managed firewall and a free tier that would cover pilots. Not chosen first only because the proxy must run as a separate service, which means more moving parts for a solo builder. It's the fallback.
- **In-app URL checks only:** rejected in addendum 2.2, because sub-resources, redirects and WebRTC bypass them.

## Evidence

- Fly.io pricing: https://docs.fly.io/about/pricing (fetched 2026-10-29)
- AWS Fargate pricing: https://aws.amazon.com/fargate/pricing/ (fetched 2026-10-29)
- Cloud Run pricing: https://cloud.google.com/run/pricing. The live page didn't extract in full. The figures above are a range from secondary sources:
  - https://cloudchipr.com/blog/cloud-run-pricing
  - https://hamy.xyz/blog/2025-04_google-cloud-run-pricing

  **Confirm on the live page before choosing the fallback.**

- Smokescreen: https://github.com/stripe/smokescreen (source `pkg/smokescreen/smokescreen.go`: `safeResolve`, `classifyAddr`, `dialContext`)

## Revisit

- After the spike checks, or if Fly can't enforce the user-based egress lock.
- At Phase 3 load testing (3× beta volume): re-check per-scan cost with measured render times.
