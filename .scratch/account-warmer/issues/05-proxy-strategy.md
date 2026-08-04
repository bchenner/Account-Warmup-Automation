# 05 — Proxy strategy: type, vendor, binding, geo

Type: grilling
Status: resolved
Blocked by: 02

## Question

What proxy product does each profile sit behind, and what is the binding rule?

> **Ticket 02 has largely pre-answered this.** Its recommendation is **one dedicated static-ISP IP per profile on a per-IP `host:port` endpoint** — which eliminates session tokens, sticky timers, idle timeouts and silent rotation as a problem class. And a first-party constraint forces the binding mechanism regardless of preference: **Chrome supports no SOCKS5 auth and ignores credentials in `--proxy-server`** `[DOC]`, while IP-whitelist auth cannot distinguish 30 profiles egressing from one home IP. **Per-profile identity must therefore be a distinct `host:port`, never credentials.**
>
> So this ticket is now narrower than written: **pick a vendor, confirm the binding, and rule on the open sub-questions below.** Shortlist from 02: Decodo ISP Pay-per-IP (only vendor documenting IP *retention*) · IPRoyal ISP (only vendor documenting *exclusivity*) · Oxylabs **Dedicated** ISP (cheapest, zero MITM surface — the standard ISP SKU is shared with up to 3 users and is disqualified) · Bright Data ISP Dedicated Unlimited (only if Proxy Manager's SSL Analyzing is never enabled). **NetNut is FBI-seized — do not evaluate it.**

Sharpening points:

- **Type**: residential, ISP/static residential, mobile/4G, or datacenter — decided per platform or once for the fleet. Weigh against the standing research's two corrections: "platforms ban datacenter IPs" is not first-party documented anywhere, and CGNAT/mobile IPs were measured by Cloudflare as rate-limited **3× more often** despite lower bot rates.
- **Permanence**: is one IP bound to one profile for the life of the account? The standing research treats `one profile ↔ one identity ↔ one IP ↔ one fingerprint, persisted forever` as the only rule every source agrees on.
- **The one dissenting idea worth a decision**: a single `[WEAK]` source recommends rotating to a *fresh* IP specifically for profile mutations (username, display name, bio, avatar, bio link) while keeping story views on the stable IP. Cheap to implement and coherent with Meta's device/IP-as-entity model — adopt or reject explicitly.
- **Geo binding**: IP country must agree with timezone, locale, `navigator.languages` and geolocation override. Decide whether persona geo is chosen first and the IP bought to match, or the reverse.
- **Fail-closed behaviour**: what the app does when the proxy dies mid-session. Continuing on the real IP is the worst possible outcome and must be impossible by construction, not by convention.
- **Budget** at 10–30 IPs/month.

## Answer

**Vendor: Proxy-Seller — the ISP product, not mobile and not rotating residential.** Operator's decision; they already hold an account there.

**Product: Proxy-Seller ISP.** *"Static residential IPs allocated directly by internet service providers"*, from **$0.98/IP** `[DOC]`, US available, HTTP(S) and SOCKS5 both supported `[DOC]`.

### Why this holds up better than ticket 02 implied

Ticket 02 evaluated Proxy-Seller's **mobile and rotating-residential** lines and found them poor: no sticky mode, undocumented idle timeout, silent IP substitution on peer loss, no fail-closed flag. **Every one of those findings is a property of rotating products, and none of them applies to a static per-IP ISP proxy** — there is no rotation to fail, no session token, and no idle timer. Ticket 02's own conclusion was that buying static dissolves this entire problem class; Proxy-Seller ISP is a static product.

**And it turns out to document the property that matters most.** Ticket 02 credited IPRoyal as the only vendor documenting exclusivity. That was scoped too narrowly — Proxy-Seller documents it too, and more broadly:

> *"All main proxy formats available on our website are dedicated and provided for exclusive use by a single user."* … *"The only exception is Mobile Shared proxies, which are shared between multiple users simultaneously (usually 2–3 users)."* ([Proxy-Seller help](https://help.proxy-seller.com/en/articles/13334942-are-your-proxies-shared-or-individual)) `[DOC]`

ISP is a main format; Mobile Shared is the named exception. **So we get documented exclusivity — the invisible, unrecoverable failure mode — at roughly a third of IPRoyal's price.** ⚠️ Note the vendor's own CGNAT copy elsewhere (*"thousands of real subscribers can share a single public IP"*) applies to **mobile**, where "dedicated" means one customer per modem rather than one subscriber per IP. It does not apply to ISP.

### Binding rule

**One profile ↔ one ISP IP ↔ one `host:port`, for the life of the account.** Forced by the Chrome constraint from ticket 02 — no SOCKS5 auth, credentials in `--proxy-server` ignored — so identity comes from the endpoint. Auth is **IP-whitelist** (whitelist the operator's machine), which is exactly what makes a bare `--proxy-server=http://host:port` work with no extension and no auth relay.

### Country is configurable per account, defaulting to US

Operator requirement. **US is the v1 target and the priority — every account ships US** — but country is a per-account field, not a constant, and the design must not hardcode it. Proxy-Seller ISP lists US, Germany, UK, France, Spain, Netherlands, Poland, Brazil and others, so the vendor supports this.

**The coherence bundle derives from that field, not from the machine**: IP country → timezone → locale → `navigator.languages` → geolocation override must all be generated from the account's assigned country. Granularity is **country-level only** — that is what Fingerprint's `timezone_mismatch` actually checks, and vendor-claimed city geo frequently disagrees with MaxMind/IPinfo anyway. Goes to ticket 15 as a first-class field on the account, and to ticket 06 as the input to the coherence model.

### Rulings on the open sub-questions

**1. The per-action IP rotation idea — REJECTED.** The `[WEAK]` single source suggesting a fresh IP for profile mutations (username, display name, bio, avatar, bio link) does not survive contact with this architecture. Three reasons: it contradicts the one rule every platform, vendor and academic source agrees on (one profile ↔ one IP, persisted forever); under Meta's DEC model an IP is a graph node whose neighbourhood is registered accounts, so *touching a second IP adds an edge* rather than removing one; and with per-IP static endpoints it would require buying and maintaining a spare pool purely to make five actions look different. Reversible if evidence ever improves, but nothing currently justifies it.

**2. Fail-closed — satisfied by construction, plus one runtime check.** Static per-IP has no silent-substitution path: a dead proxy yields `ERR_PROXY_CONNECTION_FAILED`, and Chrome does not fall back to direct on `--proxy-server` failure. Two rules make that guarantee real: **never use a PAC file or `--proxy-auto-detect`** (either can reintroduce a direct fallback), and **run a pre-flight egress-IP assertion at the start of every session** — resolve the public IP through the proxy and abort the session unless it equals the profile's bound IP. That check, not the vendor, is the actual fail-closed mechanism. Pairs with `WebRtcIPHandling=disable_non_proxied_udp` from the map's non-negotiables.

**3. Budget.** 30 ISP IPs at $0.98–2.00 ≈ **$30–60/month**, comfortably under ticket 02's $60–90 estimate for the shortlisted vendors. Bandwidth is not metered per-GB on this product, which suits video-heavy warmup consumption.

### Two open risks, carried forward rather than closed

- ⚠️ **Retention across renewal is undocumented** by Proxy-Seller, as it is by every vendor except Decodo. The IP may change when a rental period rolls over. **Mitigation, and it is required, not optional**: store assigned IP, ASN, country and classification per profile; assert the egress IP every session (see above), so a silent renewal change surfaces immediately as a failed pre-flight instead of as a mystery ban weeks later. **Goes to ticket 18 as a re-bind case and ticket 15 as schema.**
- ⚠️ **JA4 / MITM is inference, not evidence.** `docs.proxy-seller.com` returns 403 to all automated access, so no CA-certificate requirement could be confirmed or refuted. Absence of a "trust this certificate" instruction is weak negative evidence. **Run the JA4 test once against a Proxy-Seller ISP IP before binding any profile** — if the ClientHello differs from a direct Chrome connection, the product MITMs and the whole fingerprint layer is compromised regardless of what the browser does. Ticket 02 flagged this as cheap and it is: one page load against a JA4-reporting endpoint. **Add to ticket 06's acceptance suite.**

