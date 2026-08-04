# Proxy session-persistence semantics across vendors

**Research date:** 2026-08-03
**Resolves:** [issues/02-proxy-session-semantics.md](../issues/02-proxy-session-semantics.md)
**Builds on:** [research/01-warmup-protocol.md](01-warmup-protocol.md) — proxy section (lines 807–861) and Bottom line #8. Does not repeat it.
**Question:** for the major proxy vendors, what are the *documented* session-persistence semantics, and which products can hold one IP bound to one browser profile indefinitely?

---

## How to read this document

| Label | Meaning |
|---|---|
| **[DOC]** | Stated in the vendor's own developer documentation or help centre. Directly citable. |
| **[DOC-ARCHIVED]** | Was in the vendor's own docs; retrieved from Wayback because the live site is gone. |
| **[PC]** | Vendor marketing/pricing page, vendor blog, or practitioner/review consensus. Not documentation. |
| **[WEAK]** | Single source, self-interested source, or inference from silence. |
| **NOT DOCUMENTED** | Searched and absent. **Silence is a finding, not a gap** — it means the vendor has made no commitment you can hold them to. |

**Method note.** This session's web-search budget was exhausted before research began, so every citation below is a **direct fetch of a vendor documentation URL** (discovered via `sitemap.md` / `llms.txt` doc indexes, or the vendor's Zendesk/Intercom API). That is a feature, not a limitation: nothing here is sourced from a search-result snippet or a review-site aggregation unless explicitly labelled **[PC]**/**[WEAK]**. Quotes were extracted through a summarising fetch layer; the load-bearing ones (Oxylabs 60 s / HTTP 502, SOAX 60 s / `bind-node`, IPRoyal `_killswitch-1`, Decodo's silence, Bright Data SSL Analyzing, the NetNut seizure) were **re-verified by me personally** against the primary URL and are marked ✅ below.

---

## ⚠️ Lead finding — netnut.io is serving an FBI seizure notice

`https://netnut.io/` returns **HTTP 200** with a page whose entire content is `<title>Seized by the Federal Bureau of Investigation</title>` plus a base64 JPEG banner on a black background. `www.netnut.io` 301-redirects to it. Served through Cloudflare. **Verified by me directly with `curl -I` and a body dump on 2026-08-03**, alongside control fetches of `soax.com`, `oxylabs.io` and `iproyal.com` which all returned normal sites — so this is not a fetch artefact. ✅ **[DOC — the vendor's own domain, observed directly]**

I could not read the JPEG banner, so **the legal basis, case reference, and any co-signing agencies are unknown to me and are not asserted here.** What is established: NetNut is not currently procurable, its documentation is offline, and its only integration reference was always behind dashboard auth. **Strike it from the shortlist.** Archived data is retained below for completeness and labelled **[DOC-ARCHIVED]**.

This also carries a general lesson for the build: **a proxy vendor is a supply-chain dependency that can vanish between one billing cycle and the next.** Any design that pins one IP to one account for the account's life must have a documented, rehearsed answer to "the vendor is gone tomorrow" — see *Recommendation*.

---

## Comparison table

| Vendor | Sticky max | **Idle timeout** | On timeout / peer loss | Static per-IP offered | MITM TLS? | SOCKS5 | Price @ 10–30 IPs |
|---|---|---|---|---|---|---|---|
| **Oxylabs** | 24 h (`sesstime` ≤1440 min); sticky *ports* 10 min | ✅ **60 s** — documented, consistent, on two product lines | **Silent new IP by default.** Fail-closed: `sessid_oneip` → **HTTP 502** | Yes — ISP; but standard ISP is *"Shared with up to 3 users"*. Dedicated ISP is a separate SKU | **No** — no CA-cert page exists anywhere in the doc tree | Yes — but *"does not work with Chrome"* per their own docs | **$1.60/IP/mo** @10 ISP IPs (min 10); resi $6/GB @5 GB |
| **Bright Data** | **NOT DOCUMENTED** — no cap published | **5 min** in two places, **7 min** in a third — vendor contradicts itself | **Silent reassignment by default.** Fail-closed: `-const` → **HTTP 502**; also `route_err-block` | Yes — ISP in Shared-Rotating / Shared-Unlimited / **Dedicated Unlimited** tiers | **Yes, opt-in** — Proxy Manager "SSL Analyzing" requires trusting the Bright Data CA | Yes, all four networks (:22228); resi/mobile restricted to a **target-port allowlist** | **$1.80/IP/mo** @10 ISP IPs; resi $8/GB list |
| **Decodo** (ex-Smartproxy) | 1–1440 min (`sessionduration`), default 10 min | ✅ **NOT DOCUMENTED** — verified silent across 10+ pages | Silent early rotation when the peer device drops. 502 error strings exist but **no fail-closed flag** | Yes — ISP Pay/IP, Pay/GB, Dedicated ISP. **Only vendor that documents retention across renewal** | **No** — no CA-cert instruction anywhere | Yes, all lines, same gateway port | **$2.90/IP/mo** @10, **$2.80** @20 (min 3); resi $3.50/GB @10 GB |
| **IPRoyal** | **1 s – 7 days** (`_lifetime-`) — longest published cap in the set | **NOT DOCUMENTED** | ✅ *"silently assigns a replacement"* by default. Fail-closed: **`_killswitch-1` → HTTP 410** | Yes — ISP, *"reserved just for you"* **in the docs**; sold as 24 h / 30 / 60 / 90-day rentals | **No** — no CA-cert instruction anywhere | Yes — resi :32325, ISP :12324 (**TCP + UDP**) | **from $2.70/proxy/30 d** ISP (no volume table published); resi $5.25/GB @10 GB |
| **SOAX** | 60 min (legacy gateway) / **up to 1 week** (`rotate-timed`, new gateway) | ✅ **Documented — and self-contradictory**: **60 s** inactivity (new docs, 4 pages) vs `idlettl` **900 s** mobile/Wi-Fi, **86400 s** ISP/DC (legacy docs) | ✅ Default `onerror-replace` = silent. Fail-closed: **`bind-node` + `onerror-fail` → 503 `BOUND_NODE_FAILED`** | **Effectively no** — resi/mobile/US-DC(shared) only; `/isp-proxies` and `/datacenter-proxies` both 404 | **Not documented**; no CA-cert page on either doc site | Yes (:1337); **UDP over SOCKS5 supported** | **No per-IP product.** Per-GB only, plan floor **$200/mo** (Builder) |
| **NetNut** | **NOT DOCUMENTED** (marketing claimed *"no session restrictions"*) | **NOT DOCUMENTED** | **NOT DOCUMENTED**; architecture implies silent rotation | Static Residential + "dedicated ISP" claimed — but **priced per-GB**, so a 10–30 IP fleet was never purchasable | Not documented | Yes (no UDP) | ⚠️ **DOMAIN SEIZED — not procurable** |
| **Proxy-Cheap** | **~30 min hard cap**, explicitly approximate, no duration knob | **NOT DOCUMENTED** — vendor's own KB search returns **0 hits** for the term | *"after 30 mins, it will disconnect at any time"* — no error code, **no fail-closed flag** | Yes — Static Residential (ISP) IPv4/IPv6; **dedicated-vs-shared NOT DOCUMENTED** | ⚠️ **Ambiguous** — "HTTPS proxy" mode requires installing and *"Always Trust"*-ing a vendor certificate; docs never say "root CA". **Must be tested** | **Not on rotating residential.** DC IPv4 + Static Resi + Mobile only | **~$2.12/IP/mo** static resi (min 1); rotating resi $0.78–1.50/GB but **50 GB/mo ceiling** |
| **iProxy.online** (self-hosted mobile) | **No vendor cap** — the phone holds the IP until commanded to change | **NOT DOCUMENTED** proxy-side (no such parameter exists). Vendor documents a *carrier-side* **~15–60 s** reclaim risk and ships an app keep-alive | **Fail-closed by architecture**: *"Pages won't load… Your real IP will remain hidden."* | You own the SIM — **1 device = 1 IP**, *"100% private"* | **No** — they describe MITM as what *other* proxies do; no CA required | Yes (HTTP / SOCKS5 / SOCKS5-UDP) | **$9–12.50/device/30 d** licence (−10–15% at 10–20+) **+ phone + SIM you supply** |
| **Proxy-Seller** (mobile) | **No sticky mode on mobile** — 5-min, 30-min, or manual-URL rotation only | **NOT DOCUMENTED** across 13 KB articles + collections | Silent. Their paid uptime add-on says it outright: *"the outgoing IP may change while the connection remains active"* | "Dedicated" = one *customer* per modem, not one *subscriber* per IP. Shared mobile = 2–3 users | **Not documented** | Yes | **[WEAK]** ~$40–180/mo per dedicated mobile IP → **$800–3,600/mo at 20** |
| **Astroproxy** (mobile) | *"short-term"* — **duration NOT DOCUMENTED** | **NOT DOCUMENTED** at session level (only a 45-day *port*-archival rule) | Silent, explicitly: *"Even if your IP goes offline, the system will provide a new IP"* | Port exclusivity, not IP exclusivity. **No static residential/ISP line** | **Not documented** | Yes — but **one protocol at a time per port** | Per-GB only, mobile from $0.15/GB; no per-IP product |

**Reading the table:** the "static per-IP" and "MITM" columns decide the architecture. The "idle timeout" column decides whether a rotating product is usable at all for human-paced warmup — and **six of ten vendors do not publish one.**

---

# Per-vendor detail

## Oxylabs

**Sticky maximum.** Two independent mechanisms with different caps. Username-token sessions: *"You can use the `sesstime` parameter to maintain the same IP for up to 1440 minutes (24 hours)"* ([session control](https://developers.oxylabs.io/products/proxies/residential-proxies/session-control.md)) **[DOC]**, with the honest caveat *"The session time parameter does not guarantee that all of your requests finish before the session ends."* Country sticky *ports*: *"IP stickiness works for up to 10 minutes. After that, the IP is replaced with a new one"* ([sticky entry nodes](https://developers.oxylabs.io/products/proxies/residential-proxies/session-control/sticky-proxy-entry-nodes.md)) **[DOC]**. ISP proxies: *"With unlimited-duration sessions and bandwidth"* ([ISP proxies](https://developers.oxylabs.io/products/proxies/isp-proxies.md)) **[DOC]**.

**Idle timeout — 60 s, and it is the binding constraint.** ✅ Verified verbatim on both residential and mobile: *"By default, a session lasts 10 minutes, or ends after 60 seconds without any requests – whichever comes first"* ([residential](https://developers.oxylabs.io/products/proxies/residential-proxies/session-control.md), [mobile](https://developers.oxylabs.io/products/proxies/mobile-proxies/session-control.md)) **[DOC]**. **"Whichever comes first" means `sesstime-1440` is a ceiling, not a floor — the 60 s idle rule wins.**

**On timeout — silent rotation, stated explicitly.** ✅ This is the sentence that should drive the design: *"If you pause for 60 seconds or the IP goes offline, the system assigns a new one, so your next request with `sessid-abcd1234` is routed through a different IP"* ([session control](https://developers.oxylabs.io/products/proxies/residential-proxies/session-control.md)) **[DOC]**. Same session string, different egress IP, no error. **A warmup session with a human reading pause is exactly this scenario.**

**Fail-closed mode — documented.** ✅ *"With `sessid_oneip`, the session is bound to a single exit node: once that IP is no longer available, instead of rotating to a new one, the request fails with an HTTP `502` response"*, after which you *"start a new session with a fresh `sessid_oneip` value"* (same page, and mirrored on the [mobile page](https://developers.oxylabs.io/products/proxies/mobile-proxies/session-control.md)) **[DOC]**.

**Static / ISP.** ISP proxies exist and are *"sourced from premium ASN providers"* **[DOC]** — but the pricing page states the standard SKU is **"Shared with up to 3 users"** ([ISP pricing](https://oxylabs.io/products/isp-proxies)) **[PC]**. ⚠️ **That is disqualifying under the standing research's non-negotiable "never share an IP between two managed accounts"** — MaxMind's `MINFRAUD_NETWORK_ACTIVITY` and `user_count`, and Spur's `client.count`, all price shared IPs in. You must buy the separate **Dedicated ISP** SKU ([self-service](https://developers.oxylabs.io/products/proxies/dedicated-isp-proxies/self-service.md), [enterprise protocols](https://developers.oxylabs.io/products/proxies/dedicated-isp-proxies/enterprise/protocols.md)) **[DOC]**. **Permanence: NOT DOCUMENTED.** No retention guarantee appears anywhere in the doc tree; the only related page frames IP change as customer-initiated *"Replace IPs … when you need new IPs without changing countries or quantity"* ([IP replacement](https://developers.oxylabs.io/products/proxies/ip-replacement.md)) **[DOC]**.

**Session identifier.** Username token: `customer-USERNAME-cc-DE-sessid-qwert-sesstime-10:PASSWORD` at `pr.oxylabs.io:7777` **[DOC]**. Sticky-port alternative needs no token at all — *"You do not need to pass any additional parameters, just `customer-username:password`"*, or skip auth entirely with whitelisted IPs **[DOC]**. **ISP uses one port per IP**: *"The first IP in your proxy list will always use the `8001` port"* at `isp.oxylabs.io` ([making requests](https://developers.oxylabs.io/products/proxies/isp-proxies/making-requests.md)) **[DOC]**. **That per-IP-port scheme is the cleanest possible binding for this app — see the Chrome section below.**

**MITM.** **No.** No CA-certificate page, no "SSL analysis", no "HTTPS decryption" exists anywhere in the Oxylabs doc tree (checked via [sitemap.md](https://developers.oxylabs.io/sitemap.md)). HTTPS is described only as transport to the entry node: *"fully encrypted `HTTP` connection using `HTTPS` protocol for an extra layer of security"* ([protocols](https://developers.oxylabs.io/products/proxies/residential-proxies/protocols.md)) **[DOC]**. Strong negative finding, though "no MITM" is inference from documented absence **[WEAK as a positive claim]**.

**SOCKS5 — offered, but with a Chrome-killing caveat.** *"Oxylabs Residential Proxies `SOCKS5` protocol does not work with Chrome, so we suggest using Firefox instead"* ([protocols](https://developers.oxylabs.io/products/proxies/residential-proxies/protocols.md)) **[DOC]**. Same page warns *"some websites may identify a proxy IP when using the `SOCKS5` protocol."* SOCKS5 is TCP-only (UDP in beta). Dedicated ISP: *"SOCKS5 is available upon request"* **[DOC]**.

**Price.** ISP: **$1.60/IP** @10, $1.30 @100, $1.20 @500, minimum 10 IPs, pay-per-IP with *"unlimited bandwidth with fair usage"* ([pricing](https://oxylabs.io/products/isp-proxies)) **[PC]**. ⚠️ The fair-usage cliff is real and documented: crossing *"50 GBs of usage per 1 ISP proxy in a month"* drops you from *"100 concurrent sessions per 1 purchased ISP proxy"* to *"10 concurrent sessions … for the remainder of the ongoing billing cycle"* ([fair usage](https://developers.oxylabs.io/products/proxies/isp-proxies/fair-usage-policy.md)) **[DOC]**. Residential: $6/GB @5 GB → $2.50/GB @1 TB ([pricing](https://oxylabs.io/products/residential-proxy-pool)) **[PC]**.

**Geo.** Seven levels — country, city, state, continent, ZIP, coordinates, ASN ([location settings](https://developers.oxylabs.io/products/proxies/residential-proxies/location-settings.md)) **[DOC]**. Syntax `customer-USERNAME-cc-US-city-los_angeles:PASSWORD`, ASN `customer-username-ASN-21928-sessid-abcde12345:password`. ⚠️ Country sticky ports **"do not support city-level results"** **[DOC]** — geo depth and port-based stickiness are mutually exclusive.

---

## Bright Data

**Sticky maximum — NOT DOCUMENTED.** No cap is published anywhere. Checked `/proxy-networks/config-options.md`, `/api-reference/proxy/rotate_ips.md`, `/api-reference/proxy/keep_same_peer_in_session.md`, `/proxy-networks/residential/faqs.md`, `/proxy-networks/faqs.md`, `/proxy-networks/residential/configure-your-proxy.md`, `/proxy-networks/proxy-manager/configuration.md`. **This confirms the standing research's note that third-party maximum-duration figures for Bright Data are uncorroborated [WEAK].** What they document instead is that session length is bounded by *peer availability*, not a policy timer: *"IPs are real users' devices' IPs, and therefore can be used only when the user's device is idle (i.e. the device is connected to the internet, has enough battery power, and the user is not currently using it)"* ([FAQ](https://docs.brightdata.com/proxy-networks/faqs.md)) **[DOC]**.

**Idle timeout — documented, but the docs contradict themselves.** ⚠️
- **5 minutes:** *"Session idle time is 5 minutes. In case there are more than 5 minutes idle time between two consequent requests, the second request, although carrying the same `session` parameter as the first, will use a randomly selected proxy from the pool"* ([rotate_ips](https://docs.brightdata.com/api-reference/proxy/rotate_ips.md)) **[DOC]**.
- **5 minutes, with self-inconsistent advice:** *"The Session IP is kept persistent for up to 5 minute of idle time"* … *"send a tiny keep-alive request every 30 seconds, to prevent this session from becoming idle for over a minute"* ([residential FAQ](https://docs.brightdata.com/proxy-networks/residential/faqs.md)) **[DOC]** — the keep-alive advice implies a 1-minute value, suggesting copy-paste drift.
- **7 minutes:** *"The Session IP is kept persistent for up to 7 minutes of idle time. After 7 minutes with no requests, the IP is released back to the pool"* ([general FAQ](https://docs.brightdata.com/proxy-networks/faqs.md)) **[DOC]**.

**Treat Bright Data's idle timeout as "published but unreliable, somewhere between 1 and 7 minutes."** Do not build a timing assumption on it. Note the failure mode is identical to Oxylabs' — same session string, silently different IP.

**On timeout — silent by default, two fail-closed controls.** Default: *"If the IP becomes unavailable, Bright Data will automatically assign you with another available residential IP"* and *"By default, lost sessions trigger random proxy reassignment"* **[DOC]**. Fail-closed at the session layer: *"When using the `-const` option, in case peer is unavailable you will get a `HTTP 502` Error"* ([rotate_ips](https://docs.brightdata.com/api-reference/proxy/rotate_ips.md)); *"Use the same peer for the session. If peer is unavailable, a 502 error will be returned with 'no peer available'"* ([config options](https://docs.brightdata.com/proxy-networks/config-options.md)) **[DOC]**. Fail-closed at the routing layer, which no other vendor here offers: `route_err-block` — *"if a request can't pass via proxy peer, block it and don't send via Super Proxy"* ([request error handling](https://docs.brightdata.com/api-reference/proxy/request_error_handling)) **[DOC]**. Session context is also silently lost on region change or if *"2 consequent requests carry different country, city or any other parameter."*

**Static / ISP — three explicit tiers.** *"Shared (Rotating): A rotating proxy over a pool of ~40,000 proxies, paid by usage GBs"*; *"Shared Unlimited: A set of specific proxies, shared with others"*; *"Dedicated Unlimited: A set of specific proxies, exlcusive for you"* (vendor's typo, verbatim) ([ISP config](https://docs.brightdata.com/proxy-networks/isp/configure-your-proxy.md)) **[DOC]**. **Only "Dedicated Unlimited" satisfies the one-IP-one-account rule.** Permanence is claimed as *"Keep your IPs for life"* on the [marketing page](https://brightdata.com/proxy-types/isp-proxies) **[PC]** but **NOT DOCUMENTED** in the developer docs; the docs instead note a *"Refresh charge"* when changing country on unlimited proxies, implying reallocation.

**Session identifier.** `brd-customer-<id>-zone-<zone>-session-mystring12345:<password>` — *"Each request, carrying the same `-session` value will be forwarded to the same proxy IP"* **[DOC]**. Fail-closed variant appends `-const`. A specific allocated IP can be pinned with `-ip`. Proxy Manager additionally exposes **local sticky ports**.

**MITM — yes, opt-in, self-hosted only.** ✅ Verified: *"Proxy Manager will create a secure encrypted HTTPS connection with the target site, decrypt the traffic to log requests and run rules based on your settings and then pass the response back to your client in an encrypted HTTPS connection with a certificate signed by our CA certificate"*, and *"Once you allow Proxy Manager to terminate the SSL you will also need to trust Bright Data Certificate Authority (CA)"* ([SSL certificate](https://docs.brightdata.com/general/account/ssl-certificate)) **[DOC]**. It is enabled per-port via the "SSL Analyzing" option, with a dedicated toggle API `POST /api/enable_ssl` ([enable SSL analyzing](https://docs.brightdata.com/api-reference/proxy-manager/enable_ssl_analyzing_on_all_proxy_ports.md)) **[DOC]** — an off-by-default switch. **The hosted superproxy is not implicated.** ⚠️ **For this build: never run Proxy Manager with SSL Analyzing on.** It would replace Chrome's genuine ClientHello and break JA4 coherence, which the map lists as a non-negotiable.

**SOCKS5.** *"SOCKS5 proxy connections are supported on all Bright Data proxy networks: Datacenter, ISP, Residential and Mobile"* on port 22228, `socks5h` required ([SOCKS5](https://docs.brightdata.com/proxy-networks/socks5.md)) **[DOC]**. ⚠️ Hard constraint: residential and mobile SOCKS5 reach **only target ports `8080, 8443, 5678, 1962, 2000, 4443, 4433, 4430, 4444, 1969`** — i.e. **not 443**, so ordinary web browsing over residential SOCKS5 is not possible. Datacenter and ISP allow all ports above 1024. Also *"SOCKS5 over Bright Data Residential proxy is supported only towards HTTPS targets."*

**Price.** ISP **$1.80/IP** @10, $1.45 @100, with *"a 100 GB fair usage allowance per month"* per IP; residential PAYG $4.00/GB promotional against an $8/GB list ([proxy types](https://brightdata.com/proxy-types/isp-proxies)) **[PC]**. Heavily promo-driven — the $8/GB list rate is the honest comparator against Oxylabs' $6/GB.

**Geo.** Country (`-country-us`), city (`-city-sanfrancisco`), state (`-state-ny`), ASN (`-asn-56386`, residential only), ZIP (`-zip-12345`, residential only), plus OS targeting ([geolocation targeting](https://docs.brightdata.com/api-reference/proxy/geolocation-targeting)) **[DOC]**. Their own caveat: *"City targeting works best with Residential & Mobile proxies."*

---

## Decodo (formerly Smartproxy)

**Sticky maximum — 1 to 1440 minutes, confirmed.** *"Specifies the sticky session time in minutes – can be set to any number between 1 and 1440"* ([advanced parameters](https://help.decodo.com/docs/residential-proxy-advanced-parameters)) **[DOC]**, with dashboard presets of *"1, 10, 30, or 60"* minutes plus a *"custom duration of up to 24 hours"*, default 10 minutes ([custom sticky sessions](https://help.decodo.com/docs/residential-proxy-custom-sticky-sessions)) **[DOC]**. Mobile is identical ([mobile session types](https://help.decodo.com/docs/mobile-proxy-session-types)) **[DOC]**. ISP Pay/GB publishes no numeric cap: *"Ports 10001-63000 provide a static IP address that remains until you decide to change it or the session ends"* ([ISP Pay/GB](https://help.decodo.com/docs/isp-pay-per-gb-proxy-session-types)) **[DOC]**.

**Idle timeout — NOT DOCUMENTED.** ✅ I verified this personally on the [session types page](https://help.decodo.com/docs/residential-proxy-session-types): no idle, inactivity, or no-requests timeout is mentioned for either session type. Pages checked across the doc set: `/residential-proxy-session-types`, `/residential-proxy-custom-sticky-sessions`, `/residential-proxy-advanced-parameters`, `/residential-proxy-endpoints-and-ports`, `/residential-proxy-error-definitions`, `/residential-proxy-quick-start`, `/mobile-proxy-session-types`, `/isp-pay-per-gb-proxy-session-types`, `/ssl-errors`, plus `decodo.com/faq`. **Confirmed silence.** Note what this means: their stated design — *"the IP address will remain the same for the specified duration, **regardless of the number of requests made**"* **[DOC]** — reads as *no* idle timeout, which would be ideal for warmup. But they never say so, so it is not a commitment.

**On timeout — silent early rotation, and they admit it.** *"The longer the session you have, the more chances there are that the IP will rotate before your specified time due to the residential device at the end going offline"* ([session types](https://help.decodo.com/docs/residential-proxy-session-types)) **[DOC]**. Error strings exist — *"Bad gateway. The session has failed. Please start a new session and try again"* ([error definitions](https://help.decodo.com/docs/residential-proxy-error-definitions)) **[DOC]** — but **there is no opt-in fail-closed flag**. Decodo has no equivalent of `sessid_oneip` / `-const` / `_killswitch-1` / `bind-node`. **NOT DOCUMENTED — confirmed silence.**

**Static / ISP — the only vendor that documents retention.** Three SKUs: ISP Pay/IP, ISP Pay/GB, Dedicated ISP (endpoint `isp.decodo.com:10000`) ([quick start](https://help.decodo.com/docs/dedicated-isp-proxy-quick-start)) **[DOC]**. The retention page is the strongest permanence statement any vendor in this survey makes in actual documentation: *"When you manually or automatically renew your subscription, your proxy IPs will remain the same, unless you've changed the location settings"* and *"When you downgrade your subscription, IPs are removed from the end of the list. That means the earliest-assigned IPs will be retained"* ([Pay/IP retention](https://help.decodo.com/docs/isp-pay-per-ip-proxy-ip-retention), [Dedicated ISP retention](https://help.decodo.com/docs/dedicated-isp-proxy-ip-retention)) **[DOC]**. ⚠️ Dedication itself is only claimed on the marketing page — *"100% dedicated IPs"* ([ISP pricing](https://decodo.com/proxies/isp-proxies/pricing)) **[PC]**; the docs never state dedicated-vs-shared. **Verdict: "static, retained across renewal" is documented; "exclusive to you" is not.**

**Session identifier.** Both mechanisms. Token: `user-username-session-example1-sessionduration-90:password`, or as a hostname for whitelisted IPs: `https://session-example1-sessionduration-90.gate.decodo.com:7000` **[DOC]**. Ports: `gate.decodo.com` **10001–49999 sticky**, 7000/10000 rotating; city and state endpoints have their own ranges ([endpoints and ports](https://help.decodo.com/docs/residential-proxy-endpoints-and-ports)) **[DOC]**.

**MITM.** **NOT DOCUMENTED** — no CA/root-certificate instruction exists anywhere in the Decodo docs. Their dedicated SSL page addresses only client-side staleness: *"The most common way to avoid SSL errors is to make sure that your browser/tool/code is up to date"* ([SSL errors](https://help.decodo.com/docs/ssl-errors)) **[DOC]**. Plain CONNECT tunnelling is the inference **[WEAK]**.

**SOCKS5.** Yes, on the same gateway and port as HTTP: `socks5h://user-username-session-1:password@gate.decodo.com:7000` ([protocols](https://help.decodo.com/docs/residential-proxy-protocols)) **[DOC]**. ISP and Dedicated ISP: *"Endpoint:port, HTTP, HTTPS, and SOCKS5 options are available"* **[DOC]**. Caveat: *"SOCKS5 requires advanced parameters to target specific locations."*

**Price.** ISP Pay/IP: 3 IPs $3.33/IP (min order), **10 IPs $2.90/IP ($29/mo)**, 20 IPs $2.80/IP ($56/mo) ([ISP pricing](https://decodo.com/proxies/isp-proxies/pricing)) **[PC]**. Residential: $4.00/GB PAYG, $3.50/GB @10 GB, $2.75/GB @100 GB, minimum 3 GB ([residential pricing](https://decodo.com/proxies/residential-proxies/pricing)) **[PC]**.

**Geo — the deepest of the gateway vendors.** country (ISO-2), state (`us_california`), city, **zip** (US, 5-digit), **asn** (numeric), continent ([advanced parameters](https://help.decodo.com/docs/residential-proxy-advanced-parameters)) **[DOC]**. ⚠️ **`city` and `asn` cannot be combined.**

---

## IPRoyal

**Sticky maximum — 1 second to 7 days, the longest published cap in the set.** ✅ Verified: *"The `_lifetime-` key directs the router regarding the duration for which the session remains valid. The minimum duration is set at 1 second, and the maximum extends to 7 days"* ([rotation](https://docs.iproyal.com/proxies/residential/proxy/rotation)) **[DOC]**.

**Idle timeout — NOT DOCUMENTED.** ✅ Verified personally: the rotation page contains no idle or inactivity parameter. Also checked `/proxies/residential/api/sessions`, `/proxies/residential/proxy/making-requests`, `/making-requests/response-codes`, `/protocols`, `/location`, `/proxies/isp`, `/proxies/isp/using-proxy-strings`. **Confirmed silence.** ⚠️ IPRoyal's docs site exposes a GitBook AI answer endpoint that will assert there is *"no separate 'idle timeout'"* — that output is **machine-generated over the docs, not authored documentation. Do not cite it as a vendor statement [WEAK].**

**On timeout — the cleanest fail-closed contract in the survey.** ✅ Verified verbatim: *"By default, if a sticky session's IP becomes unavailable, the system silently assigns a replacement. To disable this behavior, add the `_killswitch-1` flag to your proxy string. When the flag is added, the proxy returns an `HTTP 410` code response instead of rotating to a new IP"* ([rotation](https://docs.iproyal.com/proxies/residential/proxy/rotation)) **[DOC]**. Related documented codes: `503` *"No proxy exit nodes match the filters you specified"*, `504` *"An exit node was selected but could not establish a connection"* ([response codes](https://docs.iproyal.com/proxies/residential/proxy/making-requests/response-codes)) **[DOC]**.

**Static / ISP — dedication stated in the docs, not just marketing.** *"Each ISP proxy is reserved just for you to offer ultimate online privacy and full control over your online activities"* ([ISP](https://docs.iproyal.com/proxies/isp)) **[DOC]** — this is the only in-documentation exclusivity statement in the survey. ⚠️ But the product is a **time-boxed rental** (24 hours / 30 / 60 / 90 days), and **whether you keep the same IP on renewal is NOT DOCUMENTED** (checked `/proxies/isp`, `/proxies/isp/dashboard/extending-an-order`, `/proxies/isp/using-proxy-strings`). Decodo documents retention; IPRoyal documents exclusivity. Neither documents both.

**Session identifier — parameters ride on the *password*, not the username.** `username123:password321_country-br_session-sgn34f3e_lifetime-10m@geo.iproyal.com:12321` **[DOC]**. ⚠️ Hard constraint: *"The value assigned to this key must be a random alphanumeric string, precisely 8 characters in length"* — session IDs that are not exactly 8 chars are invalid. Ports: HTTP/HTTPS `12321`, SOCKS5 `32325`. **ISP proxies use per-IP endpoints instead** — `http://191.116.125.248:12323` / `socks5://user:pass@191.116.125.248:12324` ([ISP proxy strings](https://docs.iproyal.com/proxies/isp/using-proxy-strings)) **[DOC]**. A session-reset API exists: `DELETE https://resi-api.iproyal.com/v1/sessions` ([sessions API](https://docs.iproyal.com/proxies/residential/api/sessions)) **[DOC]**.

**MITM.** **NOT DOCUMENTED** — no CA/root-certificate instruction anywhere (checked `/protocols`, `/making-requests`, `/isp/using-proxy-strings`) **[WEAK inference of plain tunnelling]**.

**SOCKS5.** Yes on residential and ISP. *"HTTPS & SOCKS5 compatible"* ([ISP](https://docs.iproyal.com/proxies/isp)) **[DOC]**, and ISP SOCKS5 is *"compatible with both UDP and TCP connections"* **[DOC]**.

**Price.** ISP: *"Starting from $1.80/proxy"* (24 h), *"$2.70/proxy"* (30 d), *"$2.55"* (60 d), *"$2.40"* (90 d) ([ISP](https://iproyal.com/isp-proxies/)) **[PC]** — ⚠️ **no published 10–30 IP volume tier; minimum order not specified.** Residential: $7.00/GB @1 GB, $5.25/GB @10 GB, with *"Your traffic never expires"* ([residential](https://iproyal.com/residential-proxies/)) **[PC]**. Mobile *"from $117/month"*.

**Geo.** country (comma-separated multi-country supported: `_country-dk,it,ie`), state (US, by name), city (by name), and **ISP by name** (`_isp-skyuklimited`) ([location](https://docs.iproyal.com/proxies/residential/proxy/location)) **[DOC]**. **ZIP and numeric-ASN targeting: NOT DOCUMENTED.**

---

## SOAX

⚠️ **Structural warning: SOAX runs two live, mutually contradictory documentation sets.** A legacy help centre (`helpcenter.soax.com`, gateway `proxy.soax.com:5000`, parameters `sessionlength`/`bindttl`/`idlettl`) and a new developer site (`developers.soax.com`, gateway `proxy.soax.com:1337`, rules `session`/`rotate-*`/`bind-node`/`onerror-*`). **They publish different idle timeouts.** Both are current.

**Sticky maximum.** Legacy: *"Specifies the sticky session time in seconds – from 10 seconds up to 3600 sec (60 minutes)"* ([sticky sessions](https://helpcenter.soax.com/en/articles/6723733-sticky-sessions)) **[DOC]**, default *"360 seconds (6 minutes)"* ([session parameters](https://helpcenter.soax.com/en/articles/9939557-understanding-session-parameters)) **[DOC]**. New: `rotate-timed_N` — *"Replace the node after N seconds"* with a maximum of **1 week** ([residential](https://developers.soax.com/proxies/residential.md)) **[DOC]**.

**Idle timeout — the only vendor here that publishes real numbers, and they disagree by 15×.** ⚠️ ✅ Both verified personally:
- New docs, repeated on four pages: ***"Sessions expire after 60 seconds of inactivity (no requests sent)"*** ([residential](https://developers.soax.com/proxies/residential.md), [mobile](https://developers.soax.com/proxies/mobile.md), [FAQ](https://developers.soax.com/troubleshooting/faq.md)), with *"To keep the session active, send a keep-alive request every 30 seconds"* ([building sticky sessions](https://helpcenter.soax.com/en/articles/9925415-building-sticky-sessions-connection)) **[DOC]**.
- Legacy docs: *"The `idlettl` parameter defines how long a node stays connected when there is no activity"* — **900 seconds (15 minutes) for mobile and Wi-Fi**, **86400 seconds (24 hours) for ISP and data centre** ([session parameters](https://helpcenter.soax.com/en/articles/9939557-understanding-session-parameters)) **[DOC]**.

The 30-second keep-alive instruction implies **60 s is the operative figure on the current gateway**, with `idlettl` a legacy port-5000 override. **Cite both and flag the contradiction — a vendor that publishes two answers has effectively published none you can rely on.**

**On timeout — the most expressive error contract in the survey.** Default is silent: `onerror-replace` — *"Get a new eligible node. This is the default"* **[DOC]**; *"If the IP goes offline even before the rotation time comes, a new one will automatically be assigned to you"* ([rotation](https://helpcenter.soax.com/en/articles/9947506-proxy-rotation)) **[DOC]**. Fail-closed is opt-in and layered: ✅ `bind-node` — *"Lock the session to a single node. If the node fails, requests fail immediately instead of replacing"* → **`503 BOUND_NODE_FAILED`**; `onerror-fail` — *"Return the error to your client. No retry, no replacement"*; `onerror-retry_N` — *"Retry the request up to N times on the same node, then replace. Maximum N is 10"* ([residential](https://developers.soax.com/proxies/residential.md), [core concepts](https://developers.soax.com/getting-started/core-concepts.md), [error codes](https://developers.soax.com/troubleshooting/error-codes.md)) **[DOC]**. A useful safety rail: `409 SESSION_PARAMS_MISMATCH` — *"Rules are locked on first use — you can't change them by sending different rules on a later request"* **[DOC]**.

**Static / ISP — effectively not offered.** *"Currently, residential, mobile and US Datacenter (shared) proxies are available to SOAX clients"* ([static vs residential](https://helpcenter.soax.com/en/articles/6778202-static-vs-residential-proxies)) **[DOC]**, and the datacenter line is explicitly **shared** ([US datacenter](https://helpcenter.soax.com/en/articles/8536910-us-datacenter-proxies)) **[DOC]**. The new dev docs mention *"static ISP-assigned IPs"* ([choosing proxy type](https://developers.soax.com/getting-started/choosing-proxy-type.md)) **[DOC]**, but `soax.com/isp-proxies` and `soax.com/datacenter-proxies` both **404**, and [`developers.soax.com/llms.txt`](https://developers.soax.com/llms.txt) lists reference pages for only residential and mobile. Their own definition of "static" is a hedge: *"A static proxy is more likely to have the same IP address for a long period"* **[DOC]** — *more likely*, no duration.

**Session identifier.** New gateway: `country-us-session-job42:pk_abc123@proxy.soax.com:1337`, session *"Letters, digits, underscores. Max 32 chars"*, *"Rules can appear in any order"*, *"You need at least one targeting rule in the username"* ([authentication](https://developers.soax.com/getting-started/authentication.md)) **[DOC]**. Legacy: `package-11111-sessionid-1-sessionlength-3600-bindttl-1200-idlettl-900-country-ca-isp-sasktel` **[DOC]**.

**MITM.** **NOT DOCUMENTED** either way, and **no CA-certificate install instruction exists on either doc site** (checked `/7241369`, `/9214905`, `/troubleshooting/connection-debugging.md`, `/getting-started/authentication.md`, `/core-concepts.md`, `/dashboard/quick-connect.md`, `/troubleshooting/faq.md`) — strong negative evidence, but inference **[WEAK]**.

**SOCKS5.** *"All SOAX proxies fully support HTTP, HTTPS, and SOCKS5"* ([protocols](https://helpcenter.soax.com/en/articles/7241369-http-vs-socks5-vs-https-which-proxy-protocol-should-you-use)) **[DOC]**, all on port 1337, and *"Residential and Mobile proxies support UDP. UDP works over SOCKS5 only"* ([FAQ](https://developers.soax.com/troubleshooting/faq.md)) **[DOC]**.

**Price — wrong shape for a 10–30 profile fleet.** No per-IP product exists. Per-GB with hard monthly plan floors: Builder **$200/mo + VAT** at $3.00/GB (Tier 1), Team $500/mo, Scale $1,500/mo ([pricing](https://soax.com/pricing)) **[PC]**. *"The minimum top-up is $25"* **[DOC]**. Also note *"Routing through Tier 1 instead of Tier 3 can cost up to 8× more per GB on the same plan"* **[DOC]** — the tier is a country-quality tier, so US/UK traffic is the expensive one.

**Geo — deepest of any vendor surveyed.** `country`, `region`, `city`, `isp`, `asn`, `zip`, composable: *"To target Comcast subscribers in Los Angeles: `country-us-city-los_angeles-isp-comcast`"* ([residential](https://developers.soax.com/proxies/residential.md)) **[DOC]**. Mobile carrier targeting reuses `isp` (`isp-verizon_wireless`) **[DOC]**. Lookup APIs exist for cities, regions, carriers and Wi-Fi ISPs **[DOC]**.

---

## NetNut ⚠️ domain seized — archived data only

See the lead finding. All below **[DOC-ARCHIVED]** from Wayback (homepage capture `20251230234732`, pricing `20240528195723`). NetNut never had a developer docs site; `docs.netnut.io` has zero Wayback captures, and real integration docs sat behind dashboard auth.

- **Sticky max: NOT DOCUMENTED.** Marketing claimed the opposite of a cap — *"no session restrictions"* (static), *"zero session limits"* (rotating).
- **Idle timeout: NOT DOCUMENTED.** Zero mentions of idle/TTL/keep-alive on any archived page.
- **On timeout: NOT DOCUMENTED**; architecture implies silent rotation — *"Each request you make goes to one of our super proxies (load balancing servers), which then provide you with the IP address that is most likely to be available in the requested location"* (`netnut.io/faq/`).
- **Static/ISP:** claimed *"dedicated ISP proxies network"* built on DiViNetworks ISP peering rather than P2P — *"DiViNetworks provides services to over 100 ISPs"*. **Retention duration NOT DOCUMENTED.** Hard constraints they did publish: static and rotating required **separate plans**, and *"If you are planning on using statc residential, Google won't work"* (typo theirs).
- **Session identifier:** `username-cc-country_code-sid-static_number`, *"Static number can be up to 8 digits"*. **No TTL parameter existed in the syntax at all.**
- **SOCKS5:** yes; UDP no. **MITM: NOT DOCUMENTED.**
- **Price:** per-GB across *every* line including "static" — ISP tiers ran **$17.50/GB** (20 GB / $350) down to $5/GB at 1 TB; minimum *"5 GB, starting at $100 (rotating) or $115 (static)"*. **A 10–30 IP fleet was never a purchasable unit.**
- **Geo:** country + US city/state only; no ASN or carrier targeting.

---

## Proxy-Cheap

⚠️ **Weakest documentation in the survey.** `docs.proxy-cheap.com` renders as a bare title with no content; `/llms.txt` and `/introduction` 404; the Zendesk help centre 403s to direct fetches and had to be mined through the Zendesk REST API (`/api/v2/help_center/en-us/articles.json`, **83 articles total** — a complete corpus).

**Sticky maximum — ~30 minutes, hard, and explicitly approximate.** *"keeps IP sticky for ~30mins; after 30mins, it will disconnect at any time"* and *"All generated IPs will be valid for ~30mins and after that proxies will disconnect at any time"* ([rotating residential tutorial](https://support.proxy-cheap.com/hc/en-us/articles/30423207064349-How-to-use-residential-rotating-proxies-Step-by-Step-Tutorial)) **[DOC]**. Their "long session" feature does **not** extend it — *"allowing you to keep the same IP for up to 30 minutes"* ([NNID long sessions](https://support.proxy-cheap.com/hc/en-us/articles/24604073441693-How-to-use-long-session-IDs-NNID-for-rotating-residential-proxies)) **[DOC]**. There is no `sessionduration`-style knob. **48× shorter than Decodo's cap, 336× shorter than IPRoyal's.** Static mobile has no timer at all: *"Currently, we only support manual rotation via the dashboard icon. Auto-rotate by timer is not available yet"* ([automatic rotation](https://support.proxy-cheap.com/hc/en-us/articles/27767171761309-Can-I-schedule-automatic-rotation-e-g-every-5-minutes)) **[DOC]**.

**Idle timeout — NOT DOCUMENTED, with unusually strong evidence of absence.** A full-text search of the vendor's own knowledge base for `idle inactivity timeout` returns **`"count":0`** — zero matching articles out of 83. **Confirmed silence.**

**On timeout — "disconnect", but never specified.** The word *"disconnect"* suggests failure rather than silent substitution, which would be the safe behaviour — but Proxy-Cheap **never states it, gives no error code, and documents no fail-closed option**. Treat as unverified **[WEAK]**. Recovery is by regenerating credentials: *"different password = different IP after connecting to proxy"* **[DOC]**.

**Static / ISP.** Static Residential (ISP) IPv4 and IPv6 exist, sold in 7-day to 12-month terms. Only the *rotating* pool is stated to be shared: *"Rotating residential proxies use shared IP pool"* **[DOC]**. ⚠️ **Whether a static IP is exclusively yours, and whether you keep it across renewal, is NOT DOCUMENTED anywhere in the 83-article corpus.** ISP is locked at purchase — on switching ISP: *"By default no, we do not support this as a feature"* ([switch ISP](https://support.proxy-cheap.com/hc/en-us/articles/24651848459421-Can-I-switch-ISP-for-my-current-Static-Residential-Proxy)) **[DOC]**.

**Session identifier — NOT PUBLISHED.** There is no `user-xxx-session-yyy` username string and no sticky-port range documented anywhere. Sessions are credential-pairs generated in the dashboard UI: *"you can either have the IP change with every request or retain the same IP for a session. The session is simply a randomly generated string"* ([what is a rotating proxy](https://support.proxy-cheap.com/hc/en-us/articles/24651517561245-What-is-a-rotating-proxy)) **[DOC]**. ⚠️ **This is a genuine integration blocker: you cannot construct or vary sessions programmatically from the documentation.** Auth supports *"both username/password and IP whitelist"* **[DOC]**.

**MITM — ambiguous, and it must be tested before use.** ⚠️ Their "HTTPS proxy" setup instructs: *"Download and open the certificate file provided by the customer care support on your device. The certificate should appear under the System Keychain"* … *"expand the 'Trust' section. Then from the 'When using this certificate' dropdown, select 'Always Trust'"* ([enable HTTPS proxy in Mac](https://support.proxy-cheap.com/hc/en-us/articles/24604116151325-How-to-enable-HTTPS-proxy-in-Mac)) **[DOC]**. I re-fetched this article through the Zendesk API to check: **it never says "root", "CA", or "certificate authority", and never mentions re-signing.** Two readings are consistent with the text — (a) it is the proxy server's *own* TLS certificate, trusted so the client can connect to the proxy over TLS (a legitimate, non-intercepting `https://` proxy scheme, which Chrome supports); or (b) it is an interception CA. **Do not assume either. Test it** with the JA4 procedure in the TLS section below. **No other vendor in this survey asks you to trust a certificate at all.**

**SOCKS5 — patchy, and the docs contradict each other.** Per the [protocols article](https://support.proxy-cheap.com/hc/en-us/articles/24651859264797-What-proxy-connection-protocols-are-supported) **[DOC]**: SOCKS5 on Datacenter IPv4, Residential Static, and Mobile; **not on rotating residential**; HTTPS on Mobile only. ⚠️ The NNID article says the opposite — *"SOCK5 can only be used after receiving long session token"*, implying SOCKS5 *is* reachable on rotating residential. **Unresolved vendor self-contradiction.**

**Price — cheapest per unit in the survey.** Static Residential IPv4 *"Starts at $2.49 → $2.12/month"* per proxy, minimum 1 → **~$21–64/mo for a 10–30 fleet**; Static Residential IPv6 from $0.52/mo; rotating residential $1.50/GB @3 GB down to $0.78/GB @51 GB ([pricing](https://proxy-cheap.com/pricing)) **[PC]**. ⚠️ **Rotating residential is capped at *"Maximum: 50 GB per month"*** — no competitor imposes this. Static Mobile $3.50/proxy; Datacenter IPv4 from $1.18/proxy.

**Geo — the docs contradict each other.** The [targeting options table](https://support.proxy-cheap.com/hc/en-us/articles/24651807759901-What-are-the-targeting-options-for-our-proxies) **[DOC]** says residential supports country + region/state + city, and static residential supports country + ISP/carrier. The rotating-residential tutorial says residential *"can only target country level"* **[DOC]**, and the NNID article reinforces it — *"State and City shall be left on Random if you wish to use Long Session ID."* **Practical read: city/state targeting and long sessions are mutually exclusive.** No ZIP, no ASN, and **no targeting parameter syntax is published at all**.

---

## Mobile / 4G specialists

### iProxy.online — self-hosted (you supply the phone and SIM)

Structurally different from everything else here: **you own the last mile.** The IP is your SIM's IP; iProxy is software running on an Android handset that exposes it as an HTTP/SOCKS5 endpoint.

- **Sticky maximum — no vendor cap.** *"The phone's IP stays constant unless a command is given to change it"* ([how IP change works](https://iproxy.online/faq/how-ip-change-works)) **[DOC]**. Their own 30-day measurement study reports *"No ceiling for an active line — most carriers"* and *"the longest holds on Verizon and AT&T ran the full 30-day measurement window"*, against a minority that *"reset it on a fixed session timer (24 h on O2 Germany, SFR and KDDI, 12 h on Free Mobile, 4 h on WIND TRE)"* ([mobile IP analytics](https://iproxy.online/blog/mobile-ip-address-analytics/)) **[PC — vendor blog, self-reported telemetry]**.
- **Idle timeout — none proxy-side; the risk is carrier-side and they document it.** No idle/TTL parameter exists in the API — every `*timeout*` field is a device watchdog (`no_network_airplane_toggle_timeout_seconds`, `no_network_reboot_timeout_seconds`) ([API](https://iproxy.online/docs-api-connection)) **[DOC]**. The carrier risk: *"on some operators and regions with heavily loaded pools, a line that goes quiet can lose its address within ~15–60 seconds"*, mitigated because *"the app's keep-alive does the staying-active part"* **[PC]**. **This is the same 60-second failure mode as Oxylabs — but here the vendor ships the keep-alive rather than charging you for the consequence.**
- **On failure — fail-closed by architecture.** *"Pages won't load since you don't have Internet access. Your real IP will remain hidden."* ([troubleshooting](https://iproxy.online/faq/solving-problems-when-raising-a-proxy-through-iproxy)) **[DOC]**. ⚠️ But the documented auto-recovery draws a *new* IP: *"Briefly switching Airplane Mode on and off forces the device to reconnect"* **[PC]** — so auto-recovery must be disabled for warmup profiles.
- **Dedication.** *"Yes, the mobile proxies are 100% private"* ([proxy characteristics](https://iproxy.online/faq/proxy-characteristics-raised-through-the-iproxy-application)) **[DOC]**. Their telemetry claims *"a public IPv4 address on our network is held by a single connection about 96% of the time, and a public IPv6 about 99.7%"* **[PC — self-reported, unaudited]**.
- **MITM — no, and their explanation is the best written in the survey.** *"From this point on, the proxy is a dumb pipe; it forwards raw TCP bytes in both directions… It can't read your HTTPS traffic, can't modify it, can't cache it"*, contrasted with MITM proxies which *"terminate your TLS session, decrypt the traffic, inspect it… This requires the proxy's CA certificate installed on the client machine"* ([SOCKS5 vs HTTP proxy](https://iproxy.online/blog/socks5-vs-http-proxy/)) **[PC — vendor blog, but technically correct and consistent with RFC 9110]**. **No CA install required for iProxy itself.**
- **Session identifier — per-phone endpoint, no token.** `hostname` + `port` + `auth.login`/`auth.password`, `listen_service` `http` or `socks5`, `auth_type` `userpass` or `noauth` ([API](https://iproxy.online/docs-api-connection)) **[DOC]**. Rotation is explicit and fully documented: `GET https://i.fxdx.in/actionlinks/do/changeip/{link_id}`, or `POST /api/console/v1/connection/{id}/command-push` with `{"action": "changeip"}`. Scheduled rotation via `ip_change_enabled` / `ip_change_interval_minutes` — **leave these off**.
- **Price.** $9/device/30 d (Basic), $12.50 (Pro), volume −10% at 10+, −15% at 20+, −20% annual ([pricing](https://iproxy.online/pricing)) **[PC]** → **~$10.60–11.25/device/mo at a 10–30 fleet**. ⚠️ **Hardware is yours**: Android 6.0+, ≥2 GB RAM, 4G, *"insert a SIM card ONLY into SLOT #1"* — **dual-SIM does not yield two proxies; one device = one licence = one IP** ([requirements](https://iproxy.online/faq/technical-requirements-for-an-android-device)) **[DOC]**. Realistic all-in: ~$11 licence + ~$40–120 used handset (amortised) + an uncapped data SIM, **per profile**.
- **Geo.** Wherever the phone physically is. Their resale store is country-granularity only; **no city or carrier selector** **[DOC]**.

### Proxy-Seller (mobile)

`docs.proxy-seller.com` **403s** to every fetch, so the formal API reference is unreadable; the usable corpus is the Intercom help centre.

- **No sticky mode on mobile.** Only *"The IP address is automatically refreshed every 5 minutes"* / *"The IP changes every 30 minutes"* / manual URL rotation ([mobile rotation options](https://help.proxy-seller.com/en/articles/13334663-ip-rotation-options-for-mobile-proxies)) **[DOC]**. Residential contradicts itself: *"up to 24 hours"* ([residential rotation](https://help.proxy-seller.com/en/articles/13334627-ip-rotation-options-for-residential-proxies)) vs *"IP retention for an average of up to 12 hours"* ([what are residential proxies](https://help.proxy-seller.com/en/articles/13310912-what-are-residential-proxies)) **[DOC]**.
- **Idle timeout — NOT DOCUMENTED** across 13 articles and three collections read in full.
- **On peer loss — silent, and they say so in the product copy for the feature you'd buy to prevent it.** *"The system automatically switches to another IP if the source device disconnects"* **[DOC]**; and for their paid 100%-uptime add-on: *"If one of the IP addresses becomes unavailable, the system automatically switches the connection to a backup IP"* and ***"the outgoing IP may change while the connection remains active"*** ([100% uptime](https://help.proxy-seller.com/en/articles/13616242-what-is-proxy-100-uptime)) **[DOC]**. **No fail-closed mode.**
- **Dedication — their clearest disclosure, and it is a warning.** *"All main proxy formats available on our website are dedicated and provided for exclusive use by a single user"*, while Mobile Shared are shared *"between multiple users simultaneously (usually 2–3 users)"* ([shared or individual](https://help.proxy-seller.com/en/articles/13334942-are-your-proxies-shared-or-individual)) **[DOC]**. But read against their own CGNAT copy — *"thousands of real subscribers can share a single public IP"* ([blog](https://proxy-seller.com/blog/mobile-proxies-vs-residential-proxies:-key-differences-and-use-cases/)) **[PC]** — **"dedicated" means one *customer* per modem, not one *subscriber* per IP.**
- **Session identifier — sticky port per proxy.** ⚠️ The rotation-link URL format is **NOT DOCUMENTED** — its existence is described but the syntax is never printed; it is issued per order.
- **SOCKS5** yes **[PC]**. **MITM: NOT DOCUMENTED** — no CA instruction, no affirmative statement either way.
- **Price.** Vendor page shows only *"Mobile proxies Starts from $10"* ([price](https://proxy-seller.com/price/)) **[PC]**; per-unit figures exist only in review sources — dedicated mobile $40–180/mo, *"T-Mobile 5G is the most expensive at $180/month"* ([Proxyway](https://proxyway.com/reviews/proxy-seller)) **[WEAK]**. **At 20 dedicated US mobile IPs, budget $800–3,600/mo.** No volume tier for mobile; discounts are rental-period-based.
- **Geo.** Country + carrier at checkout; **no city on mobile**; no ASN. Syntax not published.

### Astroproxy (second specialist; LTESocks and proxy-ipv4 were unreadable — 403 / empty body)

- **Sticky maximum — mode exists, duration NOT DOCUMENTED.** *"'Sticky Session' means you can keep a short-term fixed IP within one session"* ([FAQ](https://astroproxy.com/en/faq)) **[DOC]**. No number attached to "short-term".
- **Idle timeout — NOT DOCUMENTED** at session level. The only published inactivity rule is port-lifecycle: ports idle >45 days are archived, deleted after 14 more **[DOC]**.
- **On peer loss — silent, stated plainly.** *"Even if your IP goes offline, the system will provide a new IP from the similar geolocation"*, and on unexpected changes: *"This happened due to a high network activity or the core mechanics of CGNAT technology"* **[DOC]**. **No fail-closed mode.**
- **Dedication is *port*-level, not IP-level.** *"Astro provides individual ports… There is only one user per a single IP port"* **[DOC]** — which sits in direct tension with their own CGNAT marketing. **No static residential/ISP line at all.**
- **Session identifier — the best programmatic model of the mobile specialists.** Ports are API objects: `POST /api/v1/calculate` with `rotation_by` ∈ `time`/`link`/`request`, `rotation_time_type` ∈ `hours`/`minutes`; rotation on demand via `GET /api/v1/ports/{id}/newip` ([API docs](https://astroproxy.com/en/blog/api-documentation)) **[DOC]**. Floor: *"You can change the external IP address every 30 seconds for any port"* **[DOC]**.
- **SOCKS5** yes — ⚠️ *"You can operate one protocol at once and change it anytime"* **[DOC]**. **MITM: NOT DOCUMENTED.**
- **Price.** Per-GB only, mobile *"start from $0.15 per GB"* **[PC]**, billed on max(upload, download): *"We charge for one that turns out bigger"* **[DOC]**. **No per-IP product.**
- **Geo.** Country → city → carrier as first-class API parameters (`/api/v1/countries`, `/cities`, `/operators`) **[DOC]**. **No ASN, no region/state tier.**

---

# Does the product MITM TLS?

## Why this is the hardest constraint

The map lists "the proxy must not MITM TLS" as a non-negotiable, and the mechanism is worth restating precisely because it decides which products are eligible at all.

**JA4 is computed from the client's own ClientHello.** The spec: *"JA4 looks at the TLS Client Hello packet and builds a fingerprint of the client based on attributes within the packet"* — TLS version, SNI presence, cipher suites, extensions, ALPN, signature algorithms ([FoxIO JA4 technical details](https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4.md)) **[DOC]**. And JA3/JA4 are first-class rate-limiting keys at the WAF layer: Cloudflare exposes *"JA3 Fingerprint"* (`cf.bot_management.ja3_hash`) and *"JA4"* (`cf.bot_management.ja4`) as counting characteristics alongside *"AS Num"* ([rate limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)) **[DOC]**.

**A CONNECT tunnel preserves it; a decrypting proxy does not.** RFC 9110: *"A tunnel acts as a blind relay between two connections without changing the messages"* ([RFC 9110 §CONNECT](https://www.rfc-editor.org/rfc/rfc9110#name-connect)) **[DOC]**. Chromium confirms the browser behaviour end-to-end: *"When proxying https:// requests through an HTTP proxy, the TLS exchange is forwarded through the proxy using the CONNECT method, so end-to-end encryption is not broken"* ([Chromium proxy docs](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)) **[DOC]**. SOCKS5 operates below TLS entirely ([RFC 1928](https://www.rfc-editor.org/rfc/rfc1928)) **[DOC]**.

**Therefore the test is simple: does the vendor ever ask you to install and trust a certificate?** If yes, that mode terminates TLS. If no CA-certificate page exists anywhere in the vendor's doc tree, the product is almost certainly a plain tunnel.

| Vendor | CA-certificate install documented? | Verdict |
|---|---|---|
| Oxylabs | No page exists in the entire doc tree | **No MITM** [DOC — negative finding] |
| Bright Data | **Yes** — Proxy Manager "SSL Analyzing", *"trust Bright Data Certificate Authority (CA)"* | **MITM available, opt-in, self-hosted only. Do not enable.** [DOC] |
| Decodo | No | **No MITM** [WEAK — inferred from absence] |
| IPRoyal | No | **No MITM** [WEAK — inferred from absence] |
| SOAX | No, on either doc site | **No MITM** [WEAK — inferred from absence] |
| NetNut | No (archived) | Unknown; moot |
| **Proxy-Cheap** | **Yes** — *"Always Trust"* a support-supplied certificate for "HTTPS proxy" mode; never says "root"/"CA" | ⚠️ **Ambiguous — must be tested** |
| iProxy.online | No; they describe MITM as what other proxies do | **No MITM** [DOC-adjacent] |
| Proxy-Seller | No | **Not documented** [WEAK] |
| Astroproxy | No | **Not documented** [WEAK] |

## The empirical test the app should run once per vendor

Absence of a CA page is inference, not proof. Run the profile's real Chrome through the candidate proxy and compare its JA4 against the same Chrome direct:

1. `https://tls.peet.ws/api/all` — returns JA4, JA4_R, JA3, full ClientHello ciphers/extensions/groups/signature algorithms, plus TCP/IP layer details.
2. `https://browserleaks.com/tls` — *"displays your web browser's SSL/TLS capabilities, including supported TLS protocols, cipher suites, extensions, and key exchange groups"* with JA3/JA4.

**If JA4 changes when the proxy is in path, the proxy is intercepting — reject the vendor or the mode.** Also check the certificate issuer chain in DevTools: a genuine tunnel shows the target site's real issuer.

---

# ⚠️ Chrome cannot authenticate to a proxy — this decides the binding mechanism

This is not in the ticket but it constrains every answer to it, and it is first-party documented.

- ***"No authentication methods are supported for SOCKSv5 in Chrome (although some do exist for the protocol)."*** ([Chromium proxy docs](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)) **[DOC]**
- ***"Chrome does not implement this, and will not use any credentials embedded in the proxy settings."*** (same page) **[DOC]**
- Oxylabs confirms the consequence at vendor level: *"Oxylabs Residential Proxies `SOCKS5` protocol does not work with Chrome, so we suggest using Firefox instead"* **[DOC]**.
- One more leak to note: *"when establishing the tunnel, the hostname of the target URL is sent to the proxy server in the clear"* unless you use an `https://`-scheme proxy, in which case *"the hostnames for proxied https:// URLs is also not revealed"* **[DOC]**.

**Consequences for a 10–30 profile fleet on one Windows box:**

| Binding mechanism | Works with bare `--proxy-server`? | Notes |
|---|---|---|
| **Per-IP host:port endpoint + IP whitelist** | ✅ **Yes** | Oxylabs ISP (`isp.oxylabs.io:8001`, 8002…), IPRoyal ISP (`ip:12323`), Proxy-Cheap static, mobile modems, iProxy per-phone. **No auth, no extension, no session timer, no token.** |
| Sticky port + IP whitelist | ✅ Yes | Decodo `gate.decodo.com:10001–49999`; Oxylabs country ports (10-min cap). |
| Username-embedded session token | ❌ **No** | Needs proxy auth → a per-profile MV3 extension answering `onAuthRequired`, or a local auth-injecting relay. Adds a moving part to every profile. |
| SOCKS5 with username/password | ❌ **Never** | Chrome has no SOCKS5 auth. SOCKS5 is only usable with IP-whitelist auth. |

⚠️ **And IP whitelisting cannot distinguish 30 profiles on one box** — they all egress from the same home IP, so whitelisting authorises the *machine*, not the profile. **Which means per-profile identity must come from a distinct proxy `host:port`, not from credentials.** That is a strong architectural argument for per-IP-endpoint static products over token-based rotating pools, entirely independent of the session-timer question.

---

# Proxy type suitability — testing the standing research's three corrections

## Correction 1 — "platforms ban datacenter IPs" is still not first-party documented, and new evidence weakens the folklore further

**Carried forward and confirmed: no first-party statement was found.** Nothing in Meta, Instagram, Threads, TikTok or X documentation states that datacenter IPs are blocked, throttled or penalised for normal account use. This research added no new first-party evidence either way.

**New evidence, and it points *away* from IP-type determinism:**

- **Cloudflare's IP-reputation threat score is dead.** *"the threat score is always `0` (zero)"*, and Cloudflare explicitly recommends against building rules on it because it is *"no longer being populated"* ([Security Level](https://developers.cloudflare.com/waf/tools/security-level/)) **[DOC]**. The industry's most widely deployed pure-IP-reputation signal has been retired.
- **Cloudflare's bot score does not name IP type as an input.** The documented inputs are *"Various request features (headers, session characteristics, and browser signals)"*, and the detection engines are heuristics, machine learning, JavaScript detections (*"identifies headless browsers and other malicious fingerprints"*), anomaly detection, and verified bots ([bot score](https://developers.cloudflare.com/bots/concepts/bot-score/)) **[DOC]**. **ASN, hosting provider, datacenter IP and IP reputation are not named.**

**Counterweight — where IP *type* and ASN still bite:** ASN remains a first-class **rate-limiting** key (`ip.src.asnum`), alongside `cf.unique_visitor_id` ("IP with NAT support"), JA3 and JA4 ([rate limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)) **[DOC]**. And Meta's DEC paper makes IP a graph node with `reputation` as a direct feature (standing research) **[DOC]**.

**Net reading:** the risk from a datacenter IP is not a documented ban; it is (a) trivial classification by every commercial IP-intelligence vendor, and (b) ASN-scoped rate limiting that a fleet concentrated in one hosting ASN would collide with. **"Use residential/ISP" remains a prudent default, not an established fact** — exactly as the standing research concluded. **Do not upgrade it to a fact on the strength of anything in this document.**

## Correction 2 — mobile/CGNAT is not a safety blanket, and the Cloudflare data is *weaker* for mobile than the standing research allowed

Re-verified the source, and found a statistic the standing research did not carry:

- ***"The median bot rate is nearly identical for CGNAT (4.8%) and non-CGNAT (4.7%) IPs."*** ([Cloudflare, Oct 2025](https://blog.cloudflare.com/detecting-cgn-to-reduce-collateral-damage/)) **[DOC]**
- *"mean bot rate is notably lower for CGNATs (7%) than for non-CGNATs (13.1%)"* **[DOC]**
- ***"CGNAT IPs are subject to rate limiting three times more often than non-CGNAT IPs."*** **[DOC]**

**The median is the robust statistic here, and it shows no difference at all.** The mean gap is driven by a right tail of very-high-bot-rate non-CGNAT IPs. So the "mobile IPs look cleaner" argument is weaker than even the standing research's framing — **and the 3× rate-limiting penalty is undiminished.**

**New vendor-side evidence, cutting both ways — and note who benefits from which claim:**

- **Vendors selling *pooled* mobile affirm CGNAT sharing.** SOAX: *"Mobile IPs are naturally shared. Carriers use NAT (network address translation) to share IP addresses across many subscribers"* ([SOAX mobile](https://developers.soax.com/proxies/mobile.md)) **[DOC]**, and *"mobile carrier IPs are shared across many real users by design. This makes them harder to block without affecting legitimate visitors"* **[DOC]**. Astroproxy: *"thousands of legitimate users share the same IP through CGNAT technology, making them virtually undetectable"* **[PC]**. Proxy-Seller: *"thousands of real subscribers can share a single public IP"* **[PC]**.
- **The vendor selling *one-phone-one-IP* denies it.** iProxy: *"It is worth correcting a myth that shows up in a lot of proxy marketing (including, frankly, older versions of this very page): the idea that 'mobile carriers use NAT, so your public IP is shared with lots of other subscribers at the same time.' On modern consumer mobile networks, that is generally **not** how it works"*, claiming *"your public IP is effectively 1-to-1 with your session"*, ~96% on IPv4 ([iProxy blog](https://iproxy.online/blog/mobile-ip-address-analytics/)) **[PC]**. ⚠️ **Their own FAQ still says the opposite**: *"multiple people use the same IP address when accessing whatever sites they're currently on"* ([iProxy FAQ](https://iproxy.online/faq/everything-about-mobile-operators-sim-cards-IP-addresses)) **[DOC]**.

**Every one of these positions is commercially self-serving, in opposite directions. That is itself the finding: the "crowd cover" premise is disputed among the very vendors who sell it, and none of them publishes an audited subscriber-per-IP figure.** No primary source verifies any ratio. **Correction 2 stands, reinforced.**

**And an independent scorer treats "shared" as a flag, not camouflage:** IPQualityScore ships `shared_connection`, documented as detecting *"Multiple simultaneous users (mobile, corporate, etc.)"* ([response parameters](https://www.ipqualityscore.com/documentation/proxy-detection-api/response-parameters)) **[DOC]**. **Mobile does not hide you inside a crowd; it labels you as being in one.**

## Correction 3 — spoofing increases identifiability

Carried forward unchanged from the standing research (Fp-Scanner, USENIX 2018). Directly relevant here: **a MITM proxy is a fingerprint spoof you did not choose.** It replaces Chrome's genuine ClientHello with the proxy's, producing a JA4 that will not match the browser's JS-visible identity — the exact incoherence Fp-Scanner shows is more identifying than not spoofing at all.

## Additional finding: "static residential" has a documented half-life

Microsoft on CovertNetwork-1658: ***"The average uptime for a CovertNetwork-1658 node is approximately 90 days"***, across *"an average of 8,000 compromised devices actively engaged … at any given time"* ([Microsoft Security blog](https://www.microsoft.com/en-us/security/blog/2024/10/31/chinese-threat-actor-storm-0940-uses-credentials-from-password-spray-attacks-from-a-covert-network/)) **[DOC]**. That is a residential proxy network's node churn measured by a third party. **It is the reason no vendor except Decodo will put a retention guarantee in writing.**

## Revised suitability table

| Type | Suitability for this build | Basis |
|---|---|---|
| **ISP / static residential, dedicated, per-IP endpoint** | **Best fit.** One IP, one profile, no session timer, no token, works with bare `--proxy-server` + whitelist, unlimited bandwidth. | Decodo documents retention; IPRoyal documents exclusivity; Bright Data has a Dedicated Unlimited tier. **[DOC]** |
| ISP / static residential, **shared** | **Reject.** Oxylabs' standard ISP is *"Shared with up to 3 users"*; Bright Data has a "Shared Unlimited" tier. | Violates the non-negotiable; `MINFRAUD_NETWORK_ACTIVITY`, `user_count`, Spur `client.count` all price it in. **[DOC]** |
| Residential (sticky, rotating pool) | **Only with a documented fail-closed flag**, and only with a ≤30 s keep-alive. Four vendors offer one. | Idle timeouts of 60 s–7 min collide directly with human-paced reading pauses. **[DOC]** |
| Mobile / 4G | **Situational, not a safety blanket.** Only if a platform surface demands it. Cheapest credible per-IP option is self-hosted. | Correction 2, reinforced. 3× rate limiting; median bot rate identical. **[DOC]** |
| Datacenter | **Avoid, but for measurable reasons** — trivial classification and ASN-scoped rate limiting, not a documented platform ban. | Correction 1 unchanged. **[WEAK]** on platform harshness. |

---

# IP reputation and classification — how an IP gets typed, and how to check before you assign

## The mechanism

**Primarily WHOIS registration strings, not traffic analysis.** MaxMind states it verbatim: *"If a VPN provider does not register subnets under names associated with them, we will likely only flag their IP ranges using the `is_hosting_provider` flag"* ([Anonymous IP DB](https://dev.maxmind.com/geoip/docs/databases/anonymous-ip/)) **[DOC]**. Their `is_residential_proxy` is defined as *"1 if the IP address is on a suspected anonymizing network and belongs to a residential ISP (does not include peer-to-peer proxy IPs)"* **[DOC]**.

**Active measurement is now a second axis.** IPinfo: *"Using our proprietary internet measurement platform, we reach 44% of the world's ASNs within 1 millisecond"* via ProbeNet ([geolocation API](https://ipinfo.io/products/ip-geolocation-api)) **[PC]**.

**And ASN "type" remains a statistical inference** — Stanford's ASdb reports 93% accuracy on 17 categories, 75% on 95 sub-categories (standing research) **[DOC]**.

**A revealing admission about residential proxies specifically.** IPinfo states that residential proxies *"bypass standard privacy detection entirely"* and require *"a separate dataset with its own methodology"* ([proxy/VPN detection](https://ipinfo.io/products/proxy-vpn-detection-api)) **[DOC]**. Their standard privacy product returns only `hosting`, `proxy`, `vpn`, `tor`, `relay`, `service` — **none of which catches a residential proxy.** This is the strongest non-vendor-marketing evidence in the whole survey for *why* residential/ISP works: it is not that platforms ban datacenter, it is that the commercial detection stack is materially worse at flagging residential-ISP-registered space.

## The enums you are scored against

| Vendor | Fields relevant here |
|---|---|
| **MaxMind** | `is_anonymous`, `is_anonymous_vpn`, **`is_hosting_provider`**, `is_public_proxy`, `is_tor_exit_node`, **`is_residential_proxy`**; connection types Cable/DSL, Cellular, Corporate, Satellite, Dialup; minFraud `MINFRAUD_NETWORK_ACTIVITY`, `EMAIL_VELOCITY`, `user_count` ([docs](https://dev.maxmind.com/geoip/docs/databases/anonymous-ip/)) **[DOC]** |
| **IPQualityScore** | `connection_type` ∈ *"Residential", "Corporate", "Education", "Mobile", or "Data Center"*; `proxy`, `vpn`, `active_vpn`, `tor`, `recent_abuse`, `frequent_abuser` (6+ months), `abuse_velocity` (high/medium/low/none), **`shared_connection`**, `dynamic_connection`, `bot_status`; documented thresholds — *"Fraud Scores >= 75 are suspicious, but not necessarily fraudulent. We recommend flagging or blocking traffic with Fraud Scores >= 90"* ([docs](https://www.ipqualityscore.com/documentation/proxy-detection-api/response-parameters)) **[DOC]** |
| **IP2Location / IP2Proxy** | proxy types VPN, TOR, PUB, WEB, **DCH** (*"Hosting Provider, Data Center or Content Delivery Network"*), SES, **RES**, CPN, EPN; separate usage-type field ((ISP) Fixed Line ISP, (MOB) Mobile ISP, …) ([IP2Proxy](https://www.ip2location.com/database/ip2proxy)) **[DOC]** |
| **Spur** | `infrastructure` ∈ DATACENTER/MOBILE/RESIDENTIAL; `client.concentration/count/spread/behaviors/types/proxies`; `risks` incl. **`GEO_MISMATCH`**, `TUNNEL`, `CALLBACK_PROXY`; `tunnels[].operator` ([Context API](https://docs.spur.us/context-api)) **[DOC]** |
| **IPinfo** | `hosting`, `proxy`, `vpn`, `tor`, `relay`, `service` — **residential-proxy detection is a separate paid dataset** ([docs](https://ipinfo.io/products/proxy-vpn-detection-api)) **[DOC]** |

## Can a buyer check an IP before assigning it? Yes — these tools

| Tool | URL | What you get | Free? |
|---|---|---|---|
| **IPQualityScore** free lookup | [ipqualityscore.com/free-ip-lookup-proxy-vpn-test](https://www.ipqualityscore.com/free-ip-lookup-proxy-vpn-test) | fraud score, proxy/VPN/Tor, `connection_type`, ISP, ASN, blacklist status | Yes — daily cap; free account gives *"1,000 free lookups"* renewing monthly **[DOC]** |
| **IP2Location demo** | [ip2location.com/demo](https://www.ip2location.com/demo) | usage type, proxy type, `is_proxy`, `is_residential_proxy`, ASN, ISP, city, ZIP, mobile carrier | Yes, single-IP **[DOC]** |
| **MaxMind GeoIP demo** | [maxmind.com/en/geoip-demo](https://www.maxmind.com/en/geoip-demo) | *"Enter up to 25 IP addresses"* — location, network, ISP/org, domain, connection type, accuracy radius | Yes, batch of 25; **Anonymous-IP flags are not in the demo** **[DOC]** |
| **IPinfo** | [ipinfo.io](https://ipinfo.io/) | ASN, org, geo; IPinfo Lite has *"unlimited API requests… No monthly fees, no credit card"* | Yes, key required **[PC]** |
| **Spur** | [spur.us/products/context-api](https://spur.us/products/context-api/) | *"20+ enrichment attributes"*, *"proxy/VPN attribution, device and connection type, and tunnel entry/exit context"*; *"intuitive dashboard for on-demand lookups"* | Trial only; **no confirmed free single-IP lookup** **[PC]** |
| Scamalytics / AbuseIPDB | scamalytics.com/ip, abuseipdb.com/check/{ip} | fraud score / abuse reports | Browser-usable; **both returned HTTP 403 to automated fetch** **[WEAK]** |

**Recommended acceptance procedure before binding an IP to a profile** — run each candidate through IPQualityScore *and* IP2Location, and reject on any of: `connection_type = "Data Center"`, `is_residential_proxy = true`, `proxy_type = RES/DCH`, `fraud_score ≥ 75`, `recent_abuse`, `frequent_abuser`, or a `shared_connection` you did not expect. ⚠️ **Note the trap in `is_residential_proxy`: a residential *proxy* IP flagged as such is worse than a plain datacenter IP, because it is affirmative evidence of proxying rather than merely of hosting.** IP2Location's own live demo returned `"is_proxy": true, "is_residential_proxy": true` for its sample address — a working demonstration that residential proxy IPs *are* detectable when the database has seen them.

Re-run the check periodically, not just at assignment: MaxMind's `MINFRAUD_NETWORK_ACTIVITY` is *"Suspicious activity has been seen on this IP address across minFraud customers"* — **a cross-customer signal your own good behaviour cannot control.**

---

# Geo precision — can you pin a city, and does anyone believe you?

## What the vendors offer

| Vendor | Country | State/region | City | ZIP | ASN | ISP/carrier |
|---|---|---|---|---|---|---|
| SOAX | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (name) |
| Decodo | ✅ | ✅ | ✅ | ✅ (US) | ✅ (number) | — |
| Oxylabs | ✅ | ✅ | ✅ | ✅ | ✅ (number) | — |
| Bright Data | ✅ | ✅ | ✅ | ✅ (resi) | ✅ (resi) | — |
| IPRoyal | ✅ (multi) | ✅ (US) | ✅ | ❌ | ❌ | ✅ (name) |
| Astroproxy | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ (carrier) |
| Proxy-Cheap | ✅ | ⚠️ docs conflict | ⚠️ docs conflict | ❌ | ❌ | ✅ (static only) |
| Proxy-Seller | ✅ | ✅ (resi) | ✅ (resi) | ❌ | ❌ | ✅ (mobile) |
| iProxy | wherever the phone is | — | — | — | — | your SIM |

⚠️ **Documented mutual exclusions worth knowing before you design the binding:** Oxylabs country sticky ports *"do not support city-level results"*; Decodo cannot combine `city` and `asn`; Proxy-Cheap requires city/state be *"left on Random"* to use long sessions; Bright Data notes *"City targeting works best with Residential & Mobile proxies."* **All [DOC].**

## How reliable is any of it?

**MaxMind, on its own data:** *"61% correctly located within 50 km, 31% located to a city but outside 50 km, 8% no city-level data available"* for the United States ([accuracy comparison](https://www.maxmind.com/en/geoip-accuracy-comparison)) **[DOC]**. And the framing statement: *"IP geolocation is inherently imprecise"*, *"The coordinates are not precise and should not be used to identify a particular street address or household"* ([City/Country DB docs](https://dev.maxmind.com/geoip/docs/databases/city-and-country/)) **[DOC]**.

**IPQualityScore, on its own data:** *"locating the user within 25 miles of the actual user in over 99.95% of lookup events"* ([free lookup](https://www.ipqualityscore.com/free-ip-lookup-proxy-vpn-test)) **[PC]**.

⚠️ **These two claims are irreconcilable.** 99.95% within 25 miles versus 61% within 50 km cannot both describe the same internet. **Practical conclusion: city-level geolocation is not a stable target — you cannot know which database the platform consults, and the databases disagree by margins larger than the thing you would be matching.**

**This confirms and sharpens the standing research's rule: match timezone, locale and `navigator.languages` to the IP's *country*, not its city.** Country-level agreement is the only thing every database concurs on. Buying a Berlin IP and setting `Europe/Berlin` is fine; buying a "Los Angeles" IP and asserting a Los Angeles persona down to the neighbourhood is asserting something you cannot verify and the platform may not see.

**Geo mismatch is a productised signal.** Spur ships `GEO_MISMATCH` in its `risks` enum ([Context API](https://docs.spur.us/context-api)) **[DOC]**, and IPQualityScore's integration guidance tells customers to pass `user_agent` and `user_language` for cross-referencing (standing research) **[DOC]**. So the check exists commercially — but it is being run against the same imprecise databases, which is exactly why country is the safe granularity.

**Verification step for the build:** after an IP is assigned, resolve its country in **at least two** independent databases (IPQualityScore + IP2Location, both free-tier) and store the answer alongside the profile. If they disagree on *country*, reject the IP. If they agree on country and disagree on city, that is normal — bind the persona to the country.

---

# Recommendation

**1. The default architecture is a dedicated static-ISP IP with a per-IP `host:port` endpoint, one per profile.** It eliminates the entire problem class this ticket was opened to investigate: no session token, no sticky timer, no idle timeout, no silent rotation, no proxy-auth extension, and it works with a bare `--proxy-server=http://host:port` on a whitelisted machine. **The session-semantics question only exists for rotating pools.**

**2. Vendor ranking for that product**, at 10–30 IPs:

| Rank | Vendor / SKU | Why | Price @ 10–30 |
|---|---|---|---|
| **1** | **Decodo ISP Pay-per-IP** | The **only vendor that documents IP retention in its own docs** — *"your proxy IPs will remain the same"* across renewal. Per-IP endpoint, SOCKS5, no CA cert, deepest geo (ZIP + ASN). Weakness: dedication is marketing-only. | $2.90/IP @10, $2.80 @20 |
| **2** | **IPRoyal ISP** | The **only vendor that documents exclusivity in its own docs** — *"reserved just for you"*. Per-IP endpoints, SOCKS5 TCP+UDP, and their residential line carries the cleanest fail-closed flag if you ever need a pool. Weakness: retention-on-renewal undocumented; no published volume tier. | from $2.70/proxy/30 d |
| **3** | **Oxylabs Dedicated ISP** | Cheapest per IP, clean per-IP-port scheme (`isp.oxylabs.io:8001`+), *"unlimited-duration sessions"*, zero MITM surface in the entire doc tree. ⚠️ **You must buy Dedicated — the standard ISP SKU is "Shared with up to 3 users" and is disqualified.** ⚠️ Concurrency cliff at 50 GB/IP/month. | $1.60/IP @10 (standard tier ref.) |
| **4** | **Bright Data ISP "Dedicated Unlimited"** | 100 GB/IP/month allowance, best geo API, `route_err-block`. ⚠️ Never run Proxy Manager with SSL Analyzing. ⚠️ Residential/mobile SOCKS5 cannot reach port 443. | $1.80/IP @10 |

**3. If a rotating residential pool is used anywhere, it must be fail-closed and keep-alived.** Four documented fail-closed contracts exist; use one, always:

| Vendor | Flag | Failure response |
|---|---|---|
| IPRoyal | `_killswitch-1` | HTTP **410** |
| SOAX | `bind-node` + `onerror-fail` | HTTP **503 `BOUND_NODE_FAILED`** |
| Oxylabs | `sessid_oneip` | HTTP **502** |
| Bright Data | `-const` (+ `route_err-block`) | HTTP **502** |

**Decodo, Proxy-Cheap, Proxy-Seller and Astroproxy have no fail-closed mode and must not be used for rotating sessions in this app** — their documented behaviour is silent IP substitution, which is precisely the failure mode that burns an account invisibly. Pair any rotating product with a **≤30-second keep-alive**, which is what both Bright Data and SOAX independently recommend in their own docs.

**4. Reject outright:** **NetNut** (domain seized; also per-GB-only pricing made a 10–30 IP fleet unpurchasable anyway). **SOAX for this fleet size** (no per-IP product, $200/mo plan floor, and two live doc sets that disagree about the single most important number). **Proxy-Cheap** unless its certificate requirement is empirically cleared — 30-minute hard cap, unpublished session syntax, no SOCKS5 on rotating residential, a 50 GB/month ceiling, self-contradicting geo docs, and a "trust this certificate" instruction it will not explain.

**5. Mobile only where a platform surface genuinely requires it.** If so, **iProxy.online** is the only option that satisfies the map's non-negotiables end-to-end: you own the IP, it is fail-closed by architecture (*"Your real IP will remain hidden"*), there is no CA certificate, and there is no vendor-side session timer. Budget ~$11/device/month licence **plus a handset and an uncapped SIM per profile** — the real cost is hardware, not software, and it does not amortise across profiles because one device is one IP. Disable `ip_change_enabled` and the airplane-mode auto-recovery.

**6. Cost shape matters more than unit price.** Warmup is video-heavy consumption (feed scroll, TikTok watch) — the exact workload per-GB billing punishes. ⚠️ **No first-party bandwidth figure was obtainable for any platform**, so any GB estimate is an assumption, not a finding. **Design so that bandwidth is not the cost driver: per-IP unlimited-bandwidth ISP products are the right shape.** If you must estimate, treat it as a configurable and instrument actual consumption in the first month before committing to a tier. At 30 profiles, a dedicated ISP fleet lands around **$60–90/month all-in**; the same fleet on per-GB residential is unbounded.

**7. Carry a vendor-exit plan.** NetNut's disappearance is the proof that this is not hypothetical. Store the assigned IP, ASN, country and classification-check results per profile in the data model (ticket 15), so that a forced migration is a controlled re-bind with a matched replacement rather than a scramble.

---

# Confidence and gaps

**High confidence — personally re-verified against the primary URL (✅ above):** Oxylabs' 60-second idle timeout, its explicit silent-rotation sentence, and `sessid_oneip` → HTTP 502. SOAX's 60-second inactivity rule, `bind-node` → 503 `BOUND_NODE_FAILED`, and the legacy `idlettl` 900 s/86400 s defaults. IPRoyal's `_killswitch-1` → HTTP 410 and the 1 s–7 day lifetime. Decodo's *absence* of any idle timeout. Bright Data's SSL Analyzing / CA-trust requirement. Chrome's lack of SOCKS5 auth. The netnut.io seizure page (verified by raw `curl` with controls).

**Medium confidence:** all other vendor quotes. They were extracted through a summarising fetch layer rather than raw HTML, so wording is high-fidelity but not guaranteed character-exact. **Spot-check any single quote before relying on it in a contract negotiation.** All pricing is promotional and volatile — Bright Data had a live 50%-off coupon at fetch time, and Proxy-Cheap and Decodo both display discounted headline rates.

**Explicit silences — the most important output of this ticket.** No idle timeout is documented by **Decodo, IPRoyal, Proxy-Cheap, Proxy-Seller, Astroproxy, or NetNut**. Only Oxylabs publishes a single consistent number. SOAX and Bright Data publish contradictory ones. **Six of ten vendors have made no commitment about the one parameter most likely to break a warmup session.** This is not a research failure; it is the state of the market, and it is the strongest possible argument for choosing a product where the question does not arise.

**Other documented silences:** IP retention duration is undocumented by Oxylabs, Bright Data (docs), IPRoyal, Proxy-Cheap, SOAX, NetNut, Proxy-Seller and Astroproxy — **only Decodo commits.** Dedicated-vs-shared is undocumented by Decodo (docs), Proxy-Cheap and SOAX. Peer online duration is undocumented by every gateway vendor; the only measured figure available is Microsoft's third-party ~90-day node average.

**Unresolved and worth an empirical test before committing:**
1. **Does Proxy-Cheap's "HTTPS proxy" mode intercept TLS?** Their certificate instruction is ambiguous and they will not say. Run the JA4 comparison.
2. **Does any of these proxies alter JA4 in practice?** "No CA-certificate page exists" is strong negative evidence but remains inference for Decodo, IPRoyal, SOAX, Proxy-Seller and Astroproxy. **The JA4 test is cheap and should be run once per vendor per product line before a profile is ever bound.**
3. **Do Decodo's sticky sessions actually survive a 5-minute idle?** Their design statement (*"regardless of the number of requests made"*) implies yes; their docs never commit. **Measure it** — a single scripted session with increasing idle gaps against an IP-echo endpoint settles it in an hour, for every vendor at once, and would turn six NOT-DOCUMENTEDs into measured numbers.

**Not investigated here (out of scope for this ticket):** the legal/ethical status of residential proxy sourcing (the standing research covers *Resident Evil* and arXiv:2404.10610 — many exit nodes are compromised or corporate hosts deployed without authorisation); per-profile proxy wiring in Chrome (ticket 10); and the fail-closed enforcement mechanism on the local box, which must be OS-level rather than proxy-level since no proxy flag can prevent Chrome from falling back to the real IP if the proxy setting itself is lost (ticket 05).
