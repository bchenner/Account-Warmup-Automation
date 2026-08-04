# Map: Account Warmer

Label: `wayfinder:map`

## Destination

A **locked build spec** for an application that does exactly **two** things and is excellent at both:

1. **Account access** — one Chrome profile per social account, each pinned to its own proxy, opening reliably and staying logged in indefinitely. The operator can pick any account and be inside it, on the right IP, in one action.
2. **Warmup** — running the activity programme that takes an account from freshly-registered to ready.

Reaching the end means every decision below is settled — architecture, data model, fingerprint strategy, per-platform automation policy, and the warmup schedules themselves — and an implementation session can start building without asking another question. **No production code is written on this map.**

**Anything that is not access or warmup is out of scope**, including everything downstream of "warmed". Scope discipline is the point: the operator has asked for two features done really well rather than a broader tool.

## Notes

**Domain.** "Warmup" = the activity programme a manually-registered account runs before its first post, so it presents as an established human account rather than a fresh automated one.

**v1 platforms: Facebook, Instagram, Threads.** ⏸️ **X and TikTok are deferred** (ticket 07) — no X accounts exist in the fleet today, and TikTok is the worst desktop-web fit. They are *deferred*, not out of scope: the destination still names five platforms, and a later effort can pick them up. Tickets 08 and 09 are parked, not closed.

**Skills every session should consult:** `/grilling` and `/domain-modeling` by default; `/prototype` for the prototype tickets; `/research` subagents for research tickets.

**Standing research.** [research/01-warmup-protocol.md](research/01-warmup-protocol.md) — 1,252 lines, 161 cited sources, every claim labelled `[DOC]` (platform-documented) / `[PC]` (practitioner consensus) / `[WEAK]`. **Read its "Bottom line" section before resolving any ticket.** Its ten findings are the constraints this map is routed around. Never quote a `[PC]` number as if it were documented.

**Settled while charting** — standing constraints for every ticket, not decisions to revisit:

- **Destination is a spec, not a build.** Plan, don't do.
- **Scale: 10–30 profiles, headful Chrome, this local Windows box.** No VPS, no Linux display server, no headless-at-scale problem.
- **Accounts are registered manually by the operator.** The app adopts an already-created account; it never signs one up.
- **Automation policy is decided per platform**, not once globally — some surfaces get app-driven engagement, others get a human-queued checklist.
- **Own the browser stack** — real Chrome, `--user-data-dir` per account, deliberate per-profile fingerprint control. Not a commercial anti-detect browser.
- **Emulating mobile from desktop Chrome is ruled out**, on three independent legs: DevTools device emulation does not touch `UNMASKED_RENDERER_WEBGL`; `os_mismatch` (TCP/IP stack vs claimed OS) is unreachable from JS; and JA4 TLS is unreachable from JS. Camoufox — a specialist tool — refuses this same class of cross-platform spoof for exactly this reason. ⚠️ **Do not cite Picasso for this** — ticket 03 downgraded it to `[WEAK]` (workshop paper, 2013 data, no Android in its validation tables). The conclusion stands; that one citation does not.
- **Operator-triggered, local, no cloud.** The operator runs one session at a time against one account, on this machine. There is no autonomous scheduler and no unattended execution (ticket 11).
- **Stack, now settled across tickets 11 / 15 / 16.** The precedent is **`app-tracker-electron` (`orbit`)**, not `auto-poster`: **Electron + electron-vite + React 18 + Tailwind + TypeScript + electron-builder**, laid out `src/{main,preload,renderer,shared}`. Plus Playwright, `zod` (load-time YAML validation *is* the schema), `pino`, `vitest`.
  ⛔ **Explicitly not in the stack:** Fastify (IPC replaces it), BullMQ + ioredis (nothing runs unattended), Postgres/SQLite/Docker (files on disk), any crypto or secrets (none stored). **The app has no HTTP server, no queue, no database, no secrets, and nothing to start before use.**

**Non-negotiables** — bake into every design, no ticket needs to re-derive them:

- `WebRtcIPHandling=disable_non_proxied_udp`. STUN runs over UDP outside the HTTP stack; `--proxy-server` does not carry it, so without this the real IP leaks past the proxy entirely.
- **Never clear cookies or delete a profile directory.** `datr`/`sb` are 2-year Meta identities described as serving "security and site integrity"; `ttwid` is TikTok's 1-year anti-fraud identity.
- **The proxy must not MITM TLS** — it would replace Chrome's genuine ClientHello and break JA4 coherence, which no JS-level work can repair.
- **Fail closed.** A dead proxy must make the session impossible, never fall back to the real IP.
- **No injection-based stealth.** CDP-injected spoofing is detectable *as* CDP-injected spoofing; `puppeteer-extra-plugin-stealth` last shipped March 2023.
- 🔴 **Everything is a deterministic script. No AI anywhere in the warmup loop** — no LLM, no vision model, no model-in-the-loop deciding what to click, what to follow, or what to write. Selectors and scripted flows only; seed selection is scripted search-and-pick, not a model judging relevance; profile content is operator-supplied data, never generated at runtime. **Consequence: selector drift has no intelligent fallback, so it is a hard maintenance cost (ticket 10) rather than something the system can absorb.**

**Standing risk.** Scripted liking and following are named violations on all five platforms `[DOC]`; posting is sanctioned via API on all five. The operator has accepted this and chosen to split the policy per platform. Tickets should keep that asymmetry visible in the design rather than re-litigating it.

## Decisions so far

<!-- one line per closed ticket: enough to judge relevance, then open the ticket for the detail -->

- [Desktop-web feature matrix](issues/01-desktop-web-feature-matrix.md) — desktop web is nearly sufficient: only five hard walls, and **story *viewing* is FULL on FB and IG**, so the backbone of the warmup schedule is unblocked. Instagram story *posting*, IG Live, IG collections, X Spaces hosting and TikTok Live are app-only `[DOC]`. Facebook Live documents a real warmup floor: account ≥60 days, ≥100 followers.
- [Proxy session-persistence semantics](issues/02-proxy-session-semantics.md) — **one dedicated static-ISP IP per profile, on a per-IP `host:port` endpoint.** Dissolves the session-timer problem entirely. Forced by a first-party constraint: **Chrome cannot authenticate to a proxy at all**, so per-profile identity must be an endpoint, never credentials. Decodo / IPRoyal / Oxylabs-Dedicated ranked; **NetNut is FBI-seized**.
- [Mobile surface feasibility](issues/03-mobile-surface-feasibility.md) — **mobile is not worth it at this scale; buy no hardware.** v1 is desktop web for FB/IG/Threads/X with TikTok deferred. Real Android is the only viable path if ever needed (Windows-hosted, no root, 2–3 accounts/phone max, 1:1 for TikTok); emulators are ruled out by `GL_RENDERER`; QA farms are ruled out by their own wipe-every-session docs. Carries **two corrections to the standing research** — Picasso downgraded to `[WEAK]`, and Safari's WebGL renderer is a masked constant.
- [Verify X's documented limits](issues/04-verify-x-limits.md) — resolved AFK; the 403 route is confirmed working (direct fetch 403s, `r.jina.ai` + cache-buster returns the article). Verbatim `[DOC]` numbers now captured: **50 posts + 200 replies/day, 500 DMs/day, 400 follows/day, 5,000 following cap**; the page's own 2,400/day figure is **stale legacy text — do not encode it**. ⚠️ **The finding that matters most: X documents an allowance of only 10 accounts, for "different, non-duplicative purposes", and the stated penalty for breaching it is "choose one account to keep. The remaining accounts will be suspended."**
- [Fingerprint coherence model](issues/06-fingerprint-coherence-model.md) — **vary almost nothing.** Only what can be set truthfully at launch (window size, timezone, locale, geolocation — all matched to the proxy country); everything requiring injection is left real, including the user agent. Separation comes from **separate profile dirs + separate IPs + separate behaviour**, not from fingerprints. 🔴 **Stated residual risk: all profiles share one true hardware fingerprint, so the fleet is visibly one device — chosen over detectably-fake devices. Does not scale past a few dozen accounts on one machine.**
- [Session driver](issues/10-session-driver.md) — **patched Playwright (`patchright`), persistent context, pinned and re-tested on every upgrade.** Injection-based stealth rejected. Input goes through CDP because `Event.isTrusted` is true there and false for page-synthesised events. **Selectors live in versioned data files, ARIA-first, and a miss aborts the session** — with no AI there is no fallback, and a silent partial session is worse than none.
- [Operator surface](issues/16-operator-surface.md) — **an Electron desktop app** (electron-vite + React + Tailwind), matching the `orbit`/`app-tracker-electron` precedent. Main process owns Playwright, Chrome, the proxy pre-flight and all file I/O; renderer is presentation over IPC. **Two verbs: Open and Run warmup.** 🔴 **Kills Fastify — the app now has no HTTP server, no queue, no database and no secrets.** Native toast on session-stopped-needs-you only; nothing routine.
- [Session durability and profile custody](issues/18-session-durability.md) — **back up the profile dir minus the caches, after every session, 3 generations plus a pinned known-good.** Caches carry no identity and their exclusion is what makes frequent backup affordable; a restore is not a device change, which is the whole point. Quarantine = **light sessions only**, cleared by the operator, never automatically. Proxy re-bind treated as expected: pre-flight abort → `ip_changed` → operator accepts or replaces → resume on a light session. ⛔ **No automatic recovery anywhere.**
- [Data model](issues/15-data-model.md) — **no database: YAML + JSONL on disk.** Three entities that don't collapse — **Persona → Profile → Account** — where *Profile* is the Chrome `user-data-dir` plus its one bound IP, and is the unit ticket 05's one-identity-one-IP rule applies to. Grouping is configurable (default: one profile per persona), with one hard invariant: **Threads always shares its persona's Instagram profile.** Follow registry is an append-only JSONL relying on the single-writer guarantee — ⚠️ **weaker than the database constraint ticket 12 assumed, and corrected there.** Absent by decision: secrets, BullMQ, Redis, Postgres, Docker.
- [Credentials, 2FA and first login](issues/14-credentials-and-first-login.md) — **there is no handover: the app creates the profile and binds the proxy first, then the operator registers the account by hand inside that window.** One device, one IP, from minute zero — the moment `[DOC]` says scoring actually happens. **The app stores no credentials at all** (no passwords, no TOTP, no encryption, no secrets in the data model); 2FA and re-login are operator-handled. 🔴 **Makes [ticket 19](issues/19-purchase-proxy-fleet.md) the critical path — no IP means no profile means no account.**
- [Health signals and the warmed gate](issues/13-health-signals-and-warmed-gate.md) — **warmed = the script's last session completed.** No polling, no invented threshold; the vendor "500 views/post" definition is formally discarded since the app never posts. Detection is **in-session only** — action block, checkpoint, logged out, captcha, banned — and on any of them the session **aborts and reports, never retries**. Health is a small **state machine** per account per platform, not a score. Recovery is advisory (no scheduler to back off), with Meta's 1/3/7/30 ladder as displayed guidance in config. ⚠️ Known limitation: the gate measures effort, not health — a blocked account still reaches its last session.
- [Fleet de-correlation rules](issues/12-fleet-decorrelation-rules.md) — **the follow graph is the entire surface.** The 793K study's three signals are all *publishing* behaviours and this app never publishes; device/IP clustering is already handled by ticket 05. Seed targets come from **persona niche → scripted on-platform search → global follow registry**. Four invariants enforced as a database constraint: no managed account follows another, **zero shared targets fleet-wide by default**, follow order shuffled per account, IG+Threads count as one. **Session-time clustering accepted as residual risk — nothing built for it.**
- [Warmup schedule model](issues/11-warmup-schedule-model.md) — **operator-triggered sessions run locally; no scheduler, nothing in the cloud.** The unit of work is a **session**, not a day: the operator hits "Run warmup" on an account and the app drives one session. Progression is a **session counter with no guard** — full operator control, accepted trade, mitigated only by a non-blocking advisory. Scripts are **declarative YAML per platform**, every count and duration a sampled range. Rest days become **light sessions**. 🔴 **Knock-on: BullMQ and Redis may be unnecessary, and fleet timing de-correlation is no longer something the app can control.**
- [Per-platform automation policy](issues/07-per-platform-automation-policy.md) — **v1 is Facebook, Instagram and Threads only; X and TikTok deferred.** Consumption, profile mutations **and follows** are all app-driven on all three, at schedule rate. **Likes, comments, saves and DMs are not performed during warmup at all** — they're steady-state behaviour, which is out of scope. **Consequence: there is no operator action queue in v1**, which collapses ticket 16 to account access plus monitoring. Threads gets a sequencing rule rather than a schedule — never auto-link at Instagram signup, and treat IG+Threads as one risk pool.
- [Proxy strategy](issues/05-proxy-strategy.md) — **Proxy-Seller ISP, one static IP per profile on its own `host:port`, IP-whitelist auth, ~$30–60/mo for 30.** Ticket 02's negative findings on Proxy-Seller were scoped to its mobile/rotating lines and don't apply to the static ISP product, which **does document exclusivity** (*"dedicated and provided for exclusive use by a single user"*) at a third of IPRoyal's price. **Country is a per-account field defaulting to US**, and the whole locale/timezone/geolocation bundle derives from it. Per-action IP rotation rejected. Two risks carried forward: retention across renewal is undocumented (mitigated by a per-session egress-IP assertion) and the JA4/MITM test is still unrun.
- [Boundary with egged / auto-poster](issues/17-boundary-with-egged.md) — closed as **out of scope**, see below.

## Not yet specified

<!-- in-scope fog: real questions, not yet sharp enough to ticket -->

- **Per-account persona** — niche, profile copy, and the operator-supplied data each account needs. Ticket 12 fixed the niche's *role* (it drives follow-target search); what a persona record actually contains is still open. ⚠️ The *timezone* half of this patch is now settled by ticket 05 (country field) and moot for scheduling since ticket 11 removed the scheduler.
- **Adopting an already-live account** — everything in ticket 14 assumes registration happens inside an app-created profile, which an existing established account cannot do. Not a v1 problem (the operator's live egged accounts are already warm and don't need this app), but the adoption path is unspecified if one ever needs it.
- **Observability and alerting** — what the operator is shown when a profile breaks at 3am: selector drift, checkpoint challenge, silent logout.
- **Selector and DOM drift maintenance** across five platforms, which is the real long-term running cost of this app.
- **Cost model** per account per month. Partially answered already — ~$60–90/month for 30 dedicated ISP IPs `[DOC]` — but the total depends on whether ticket 08 buys mobile hardware.

<!-- graduated: "ban and soft-block recovery orchestration" is now issue 18 -->
<!-- removed: "maintenance mode" is now Out of scope — downstream of warmed -->

## Ticket index

<!-- convenience only; the frontier is found by scanning issues/ for open + unblocked + unclaimed -->

| # | Ticket | Type | Blocked by |
|---|---|---|---|
| 01 | [Desktop-web feature matrix](issues/01-desktop-web-feature-matrix.md) | research | ✅ resolved |
| 02 | [Proxy session-persistence semantics](issues/02-proxy-session-semantics.md) | research | ✅ resolved |
| 03 | [Mobile surface feasibility](issues/03-mobile-surface-feasibility.md) | research | ✅ resolved |
| 04 | [Verify X's documented limits](issues/04-verify-x-limits.md) | task | ✅ resolved |
| 05 | [Proxy strategy](issues/05-proxy-strategy.md) | grilling | ✅ resolved |
| 06 | [Fingerprint coherence model](issues/06-fingerprint-coherence-model.md) | grilling | ✅ resolved |
| 19 | [Purchase and verify the proxy fleet](issues/19-purchase-proxy-fleet.md) | task | — **operator buying** |
| 07 | [Per-platform automation policy](issues/07-per-platform-automation-policy.md) | grilling | ✅ resolved |
| 08 | [Mobile surface decision](issues/08-mobile-surface-decision.md) | grilling | ⏸️ **deferred with TikTok** |
| 09 | [TikTok surface decision](issues/09-tiktok-surface-decision.md) | grilling | ⏸️ **deferred out of v1** |
| 10 | [Session driver](issues/10-session-driver.md) | grilling | ✅ resolved |
| 11 | [Warmup schedule model](issues/11-warmup-schedule-model.md) | grilling | ✅ resolved |
| 12 | [Fleet de-correlation rules](issues/12-fleet-decorrelation-rules.md) | grilling | ✅ resolved |
| 13 | [Health signals and the warmed gate](issues/13-health-signals-and-warmed-gate.md) | grilling | ✅ resolved |
| 14 | [Credentials, 2FA and first login](issues/14-credentials-and-first-login.md) | grilling | ✅ resolved |
| 15 | [Data model](issues/15-data-model.md) | grilling | ✅ resolved |
| 16 | [Operator surface](issues/16-operator-surface.md) | prototype | ✅ resolved |
| 17 | [Boundary with egged](issues/17-boundary-with-egged.md) | grilling | ⛔ out of scope |
| 18 | [Session durability and profile custody](issues/18-session-durability.md) | grilling | ✅ resolved |

## Out of scope

<!-- ruled beyond the destination; closed, never graduates -->

- **Account registration / signup *automation*** — the app never scripts a signup; the operator types. ⚠️ **Read precisely: registration still happens *inside* an app-created profile on its bound proxy** (ticket 14), which is the opposite of the app being uninvolved. What is out of scope is automating the typing, not hosting the browser.
- **SMS / phone-verification service integration** — follows directly from registration being out.
- **Publishing and scheduling posts** — `dm-engine`/egged and `auto-poster` already own this. This app hands off a warmed account; it never posts.
- **Any integration with egged / `auto-poster`** — no shared database, no API between them, no status flag the poster reads, no reach data flowing back. The operator scoped this app to access + warmup and nothing else, so the handoff is a human one: an account is marked warmed, and the operator takes it from there. Closes [Boundary with egged / auto-poster](issues/17-boundary-with-egged.md).
- **Everything downstream of "warmed"** — post-warmup steady-state caps, keep-warm/maintenance activity, and the first post itself. The map stops at the moment an account is ready.
