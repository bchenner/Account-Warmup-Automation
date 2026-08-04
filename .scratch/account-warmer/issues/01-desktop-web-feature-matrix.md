# 01 — Desktop-web feature matrix per platform

Type: research
Status: resolved
Blocked by: —

## Question

For each of Facebook, Instagram, Threads, X and TikTok: which warmup-relevant actions are **impossible**, **degraded**, or **fully available** on desktop web in a real Chrome?

This gates the per-platform automation policy (07) and the TikTok surface decision (09) — we cannot decide what the app drives until we know what desktop web can even do.

Sharpening points:

- The definitive first-party method identified by the standing research: render `help.instagram.com` with a headless browser and grep for the string **"This feature isn't available on computers"**. That produces a first-party app-only feature matrix no blog has. Do the equivalent for the other four help centres.
- Cover specifically: story viewing, story posting, reels upload, DMs, saves, follows, search, video watch-to-completion, profile edits (avatar/bio/username/bio-link), live, and notification surfaces.
- Note anything that is *available* on desktop web but *distributed differently* — the contested claim that TikTok desktop-web uploads lose substantial reach belongs here, with its evidence quality labelled.
- Label every finding `[DOC]` / `[PC]` / `[WEAK]` in the same scheme as the standing research.

Write findings to `research/02-desktop-web-feature-matrix.md`.

## Answer

Full findings: [research/02-desktop-web-feature-matrix.md](../research/02-desktop-web-feature-matrix.md) — 415 lines, master matrix plus per-platform detail.

**Desktop web is far more capable than the charting session assumed. There are only five hard walls, and four are now first-party documented:**

1. **Instagram story *posting* — IMPOSSIBLE** `[DOC]`. [help.instagram.com/1257341144298972](https://help.instagram.com/1257341144298972) carries the literal banner *"This feature isn't available on computers."*
2. **Instagram going live — IMPOSSIBLE** `[DOC]`. Same banner.
3. **Instagram saved *collections* — IMPOSSIBLE** `[DOC]` — the save itself works, filing it doesn't. Also app-only: per-account post notifications, story reply settings, Close Friends story publishing, resharing a post to story, Cutouts, templates.
4. **X hosting a Space — IMPOSSIBLE** `[DOC]`. Joining and listening are fine. X's only wall.
5. **TikTok going live from a browser — IMPOSSIBLE** `[DOC]` — LIVE Studio is downloadable software, and gated at 1k/10k followers anyway.

**Story *viewing* is FULL on Facebook and Instagram.** This is the important one: story views are the backbone of the 18-day Instagram warmup schedule, and they work fine on desktop web. Warmup is essentially unblocked; only *publishing* stories is walled.

**Facebook, Threads and X lose essentially nothing.** Sharpest contrast in the document: Facebook documents a `Computer` tab for both story creation *and* Live — same company as Instagram, opposite answer.

**A documented warmup floor worth building the schedule around:** Facebook Live from desktop requires an account **≥60 days old with ≥100 followers** `[DOC]`. That is a rare hard first-party number in a corpus that is otherwise all `[PC]`.

**Correction to the standing research: `help.x.com` is not actually blocked.** Direct fetches 403, but `r.jina.ai` with a cache-busting query param gets through — six X help pages were read this way. **This substantially overlaps ticket 04**, which was written on the assumption X was unreachable; re-scope 04 to verifying only the specific numeric limits still listed as unverified rather than the whole page set.

**The TikTok desktop-upload reach claim is `[WEAK]` in both directions and confounded.** The better-documented mechanism is **payload, not pipeline**: Instagram names "go to the audio page" as a Reels signal, and desktop cannot attach trending audio, templates or effects — so the *post* is thinner, rather than the *surface* being penalised. Feeds into ticket 09.

**Method notes worth keeping** — the technique is reusable when these help centres change:

- `help.instagram.com` is a JS-rendered SPA; direct fetches return only `Help Center`. Render through `r.jina.ai` to get article bodies.
- **Grep for the presence of `Computer Help` in the device selector, not for the banner** — some app-only articles omit `Computer` without showing a banner. Only leaf articles carry the selector; an absent banner on a hub page proves nothing.
- `support.tiktok.com` resisted every method (article bodies load from a JS API). TikTok was sourced from `creator-academy`, `live/creators`, `transparency` and `support/faq_detail` instead.

⚠️ **Two-hop extraction caveat carried forward from the research:** every help-centre quote passed through a rendering proxy and then a summarising model. The findings (banner present/absent) are reliable; **spot-check exact wording in a browser before hardcoding any quote.**

**Gaps stated as gaps:** TikTok DM/saves/search rows are `[PC]` only · TikTok Stories status, X live video, and the reported Instagram Live 1,000-follower threshold are UNVERIFIED · whether watch time is *weighted* the same on web as in-app is UNVERIFIED on all five platforms.

