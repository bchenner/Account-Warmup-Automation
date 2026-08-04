# 02 — Proxy session-persistence semantics across vendors

Type: research
Status: resolved
Blocked by: —

## Question

For the major proxy vendors, what are the **documented** session-persistence semantics, and which products can hold one IP bound to one profile indefinitely?

The standing research flagged that the likeliest cause of mid-session IP rotation is the vendor, not the platform — Oxylabs' documented default ends a session after **60 seconds idle**, which is exactly what a human-paced reading pause looks like. An IP change mid-session is a worse signal than a slow account.

Sharpening points:

- Compare at least: Oxylabs, Bright Data, Smartproxy/Decodo, IPRoyal, SOAX, and at least one mobile/4G specialist.
- For each: sticky-session maximum duration, **idle timeout**, what happens on timeout (rotate silently vs fail), whether a fail-closed mode exists, and whether static residential / ISP IPs are offered.
- Separate **residential**, **ISP/static residential**, **mobile/4G**, and **datacenter** — and note the standing research's correction that "platforms ban datacenter IPs" is not first-party documented anywhere, and that Cloudflare measured CGNAT IPs rate-limited 3× more often.
- Price per IP per month at a 10–30 IP fleet size, since cost lands on ticket 05.
- Confirm whether each product MITMs TLS — the standing research is explicit that a MITM proxy replaces Chrome's genuine ClientHello and breaks JA4 coherence.

Write findings to `research/03-proxy-session-semantics.md`.

## Answer

Full findings: [research/03-proxy-session-semantics.md](../research/03-proxy-session-semantics.md) — 492 lines, per-vendor citations, `[DOC]`/`[PC]`/`[WEAK]` labelled.

**The session-semantics question dissolves rather than gets answered.** Sticky-timer and idle-timeout behaviour only matters for *rotating pools*. A dedicated static-ISP IP on a per-IP `host:port` endpoint has no session token, no timer, no idle timeout and no silent rotation — the entire problem class this ticket opened on disappears. That is the recommended architecture: **one static ISP IP per profile.**

**The finding that reshapes the design, and which the ticket did not ask for.** Chromium's own proxy docs, first-party `[DOC]`:

> *"No authentication methods are supported for SOCKSv5 in Chrome"* … *"Chrome does not implement this, and will not use any credentials embedded in the proxy settings."*

Oxylabs confirms the consequence at vendor level (*"SOCKS5 protocol does not work with Chrome, so we suggest using Firefox instead"*). And IP-whitelist auth cannot distinguish 30 profiles on one machine — they all egress from the same home IP, so whitelisting authorises the *box*, not the profile.

**→ Per-profile proxy identity must come from a distinct `host:port`, never from credentials.** Username-embedded session tokens would require a per-profile MV3 extension answering `onAuthRequired`, or a local auth-injecting relay — a moving part in every profile, and (per the map's non-negotiables) another injected artifact. This argument for per-IP static endpoints is independent of the session-timer one and arrives at the same place.

**Vendor ranking at 10–30 IPs**, for dedicated static ISP:

1. **Decodo ISP Pay-per-IP** — the only vendor documenting IP *retention* in its own docs (*"your proxy IPs will remain the same"* across renewal). Per-IP endpoint, SOCKS5, no CA cert, ZIP+ASN geo targeting. Weakness: dedication is marketing copy, not documentation. ~$2.90/IP @10.
2. **IPRoyal ISP** — the only vendor documenting *exclusivity* (*"reserved just for you"*). Per-IP endpoints, SOCKS5 TCP+UDP. Weakness: retention on renewal undocumented. ~$2.70/proxy/30d.
3. **Oxylabs Dedicated ISP** — cheapest, clean per-IP-port scheme, unlimited-duration sessions, zero MITM surface anywhere in its doc tree. ⚠️ Must buy **Dedicated**; the standard ISP SKU is *"shared with up to 3 users"* and is disqualified by the one-IP-one-account rule. Concurrency cliff at 50 GB/IP/month.
4. **Bright Data ISP Dedicated Unlimited** — 100 GB/IP/month, best geo API. ⚠️ Only safe if Proxy Manager's opt-in "SSL Analyzing" (a real CA-trusting MITM) is never enabled.

**Rejected: NetNut — `netnut.io` is serving an FBI seizure notice**, verified with raw `curl` plus controls. Also SOAX at this fleet size (no per-IP product, $200/mo floor, and two live doc sets contradicting each other on the single most important number), and Proxy-Cheap (unexplained "trust this certificate" instruction).

**If a rotating pool is ever used, it must be fail-closed.** Four documented contracts exist: IPRoyal `_killswitch-1`→410 · SOAX `bind-node`+`onerror-fail`→503 · Oxylabs `sessid_oneip`→502 · Bright Data `-const`→502. **Decodo, Proxy-Cheap, Proxy-Seller and Astroproxy have no fail-closed mode** and must not be used for rotating sessions — their documented behaviour is silent IP substitution, exactly the failure that burns an account invisibly. Pair any rotating product with a ≤30s keep-alive.

**Supporting findings:**

- Oxylabs' **60s idle timeout is confirmed verbatim**, and it documents *silent rotation* on the same session string. Six of ten vendors publish no idle timeout at all; SOAX (60s vs 900s) and Bright Data (5min vs 7min) publish contradictory ones.
- "Static residential" has a documented half-life — these IPs are not permanent even when sold as static.
- The standing research's three corrections survived: datacenter-IP bans still have no first-party documentation, and the mobile/CGNAT evidence turned out **weaker** than the standing research allowed.
- Cost shape matters more than unit price: warmup is video-heavy consumption, the exact workload per-GB billing punishes. ~$60–90/month all-in for 30 dedicated ISP IPs; unbounded on per-GB residential. ⚠️ No first-party bandwidth figure exists for any platform — instrument actual consumption in month one rather than committing to a tier.
- Carry a vendor-exit plan and store assigned IP/ASN/country/classification per profile (ticket 15). NetNut is the proof this isn't hypothetical.

