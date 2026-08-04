# 06 — Fingerprint coherence model and acceptance suite

Type: grilling (respecified from `prototype` — the empirical run moves into the build)
Status: resolved
Blocked by: 05 ✅

## Question

Given the charting decision to own the browser stack *with* deliberate per-profile fingerprint control: which surfaces vary per profile, how is coherence guaranteed, and how do we prove it?

The central tension this ticket must resolve: Fp-Scanner (USENIX 2018) found **spoofed browsers are more identifiable than un-spoofed ones**, and Castle demonstrated catching an anti-detect browser by spotting its CDP-injected spoofing scripts. So every surface we vary must be justified, and the spoofing layer must not itself be the tell.

Sharpening points:

- **Decide the vary-set.** Candidates by measured entropy: WebGL renderer (highest uniqueness *and* stability), canvas, fonts, audio, screen/viewport, `hardware_concurrency`, `device_memory`, timezone, locale. For each: vary it, or leave it real?
- **The clustering trap**: a hardcoded ANGLE renderer string reused across 30 profiles is a *worse* signal than 30 identical real ones. Whatever varies must vary plausibly, not uniformly.
- ⚠️ **Browser-specific correction from ticket 03**: WebGL renderer is the highest-entropy surface **on Chrome only**. WebKit hardcodes `UNMASKED_RENDERER_WEBGL = "Apple GPU"` and `UNMASKED_VENDOR_WEBGL = "Apple Inc."` unconditionally `[DOC]`, so on Safari it is a masked constant carrying no entropy at all. If any profile ever presents as Safari, that row of the model needs different signals — capability limits, canvas noise injection, `MAX_TEXTURE_SIZE`.
- ⚠️ **Do not cite Picasso** in this ticket's reasoning; ticket 03 downgraded it to `[WEAK]`. Cite the Cloudflare eight-category probing result for canvas/WebGL raster hashing instead.
- **Coherence pairs that must hold** — treat as assertions in the prototype: UA ↔ `navigator.platform` · UA ↔ WebGL renderer · UA ↔ `maxTouchPoints` · canvas ↔ claimed platform · **Web Worker context values ↔ main-thread values** (vendors do multi-context collection specifically to catch this) · timezone/locale/geolocation ↔ IP country.
- **Client Hints**: `--user-agent` does not update `navigator.userAgentData` or `Sec-CH-UA-*`. If UA varies at all, decide how the high-entropy CH values are kept in sync.
- **Non-negotiables to bake in regardless**: `WebRtcIPHandling=disable_non_proxied_udp`; never clear cookies or the profile dir; a real monitor-sized viewport (not Playwright's 1280×720 default).
- **Country drives the coherence bundle** (ticket 05). Each account carries a country field defaulting to US; timezone, locale, `navigator.languages` and the geolocation override are all **derived from it**, never from the host machine. Country-level granularity only — that is what Fingerprint's `timezone_mismatch` checks, and vendor city-geo often disagrees with MaxMind/IPinfo.
- 🔴 **Run the JA4 test first, before anything else in this ticket.** Ticket 05 chose Proxy-Seller ISP, whose MITM status could not be confirmed (`docs.proxy-seller.com` 403s everything). Load a JA4-reporting endpoint through a Proxy-Seller ISP IP and compare the ClientHello against a direct Chrome connection. **If they differ, the product MITMs and the entire fingerprint layer is moot regardless of what this ticket concludes** — so this is a gate on the rest of the work, not a line item in it.
- **Build the acceptance suite** — this is the prototype's deliverable. Run a profile against `rebrowser-bot-detector`, `brotector`, CreepJS, and `deviceandbrowserinfo.com/are_you_a_bot`, and record a baseline. Include the March 2026 prototype-chain Proxy CDP trap, which was still unpatched at time of research.
- Ship a written verdict on whether varying anything at all beats presenting the real machine honestly.

## Answer

### The verdict the ticket asked for: vary almost nothing

The charting session chose "own stack **with deliberate fingerprint control**". Following the evidence, **the achievable version of that is much narrower than it sounds**, and saying so plainly is the most useful output of this ticket.

Two findings decide it. Fp-Scanner (USENIX 2018): **spoofed browsers are more identifiable than un-spoofed ones** — inconsistency is the tell. Castle (Apr 2025): **CDP-injected spoofing is detectable as CDP-injected spoofing**, via `scriptParsed` events and VM entries in memory sampling. And per the map's non-negotiables, injection-based stealth is already ruled out.

So: **anything that can only be varied by injecting JavaScript is left real.** That is not a compromise, it is the lower-risk option.

### The vary-set: only what can be set truthfully at launch

Varied per profile — all set at process/launch level, so they are coherent all the way down to the headers and the `Intl` API, with nothing injected:

| Surface | How | Why it is safe to vary |
|---|---|---|
| **Window/viewport size** | Chrome launch flag | A real window size. Also fixes a known tell — Playwright defaults to 1280×720, which is not a real monitor. |
| **Timezone** | `TZ` env var on the Chrome process | Real to the process; `Date` and `Intl` agree. **Must match the proxy country.** |
| **Locale / languages** | `--lang`, matching `Accept-Language` | Same — process-level, so headers and JS agree. **Must match the proxy country.** |
| **Geolocation** | permission override, country-accurate | Consistent with IP and timezone. |

**Left real, deliberately** — WebGL renderer, canvas, fonts, audio, `hardware_concurrency`, `device_memory`, and **the user agent**. On the UA specifically: **never pass `--user-agent`.** It does not update `navigator.userAgentData` or the `Sec-CH-UA-*` headers, and that desync is the canonical detection.

Note WebGL renderer is the highest-entropy surface *on Chrome* — and precisely because of that, a hardcoded ANGLE string reused across 30 profiles is a **worse** signal than 30 identical real ones. (On Safari it is a masked constant, per ticket 03 — irrelevant here since v1 is Chrome.)

### Where separation actually comes from

Not from fingerprints. From three layers that are genuinely independent per profile:

1. **Separate `--user-data-dir`** — separate cookies, storage and history, so each profile gets its own `datr`/`sb` browser identity from Meta.
2. **Separate static ISP IP** (ticket 05), one per profile, never shared.
3. **Separate persona and behaviour** — distinct niches, disjoint follow graphs (ticket 12), independent session timing.

### 🔴 The residual risk, stated rather than buried

**All profiles on this machine share one true hardware fingerprint — same GPU, same canvas, same fonts, same CPU.** Meta's Deep Entity Classification treats **Device as a graph node whose neighbourhood is "users sharing the device"** `[DOC]`, and TikTok says it looks for accounts that *"share technical similarities like using the same devices"* `[DOC]`. **So the fleet is, at the device layer, visibly one device.**

This is not solved by the design; it is chosen over the alternative. Faking it requires injection, injection is detectable as injection, and a detectably-spoofed device is worse than an honestly-shared one. The mitigations are the three separation layers above, plus **keeping the fleet small** — which the 10–30 scale already does.

**The honest consequence: this design does not scale past a few dozen accounts on one machine**, and adding accounts increases the device-clustering signal rather than being neutral. If the fleet ever needs to be materially larger, the answer is more real machines, not better spoofing.

### The acceptance suite — specified for the build to run

Not run now; run against the real app, and re-run whenever a dependency updates:

- **`rebrowser-bot-detector`** — `runtimeEnableLeak`, `sourceUrlLeak`, `mainWorldExecution`, `navigatorWebdriver`, `bypassCsp`, `viewport`, `useragent`, `pwInitScripts`.
- **`brotector`** — `Input.coordinatesLeak`, `window.cdc`, `Event.isTrusted`, `canvasMouseVisualizer`, `UAOverride`, `popupCrash`.
- **The March 2026 prototype-chain Proxy CDP trap**, unpatched at time of research — must be explicitly tested, not assumed absent.
- **CreepJS** and `deviceandbrowserinfo.com/are_you_a_bot` as broad checks.
- **Coherence assertions**, as tests rather than hopes: UA ↔ `navigator.platform` · UA ↔ WebGL renderer · UA ↔ `maxTouchPoints` · **Web Worker context values ↔ main-thread values** · timezone/locale/geolocation ↔ IP country.

**The TLS/MITM check is no longer part of this ticket** — it moved into the app's proxy verification (tickets 16 and 19), where it re-runs on every renewal instead of once.
