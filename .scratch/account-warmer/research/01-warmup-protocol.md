# Account Warmup Protocol — Facebook, Instagram, Threads, X, TikTok

**Research date:** 2026-08-03
**Purpose:** engineering input for a Chrome-profile + per-profile-proxy manager that drives warmup activity on newly-created or dormant accounts before they begin posting.
**Scope:** what each platform *documents*, what each platform *polices*, and what practitioners *claim*. These three are kept strictly separate.

---

## How to read this document

Every factual claim carries one of three labels:

| Label | Meaning |
|---|---|
| **[DOC]** | Platform-documented. Stated in first-party policy, help-centre, developer docs, transparency report, or engineering publication. Directly citable. |
| **[PC]** | Practitioner consensus, undocumented. Vendor/agency/operator knowledge. Useful as a starting parameter, **not** an official limit. Numbers vary and are frequently wrong. |
| **[WEAK]** | Weakly sourced. Single source, self-interested source, or inference. Treat as a hypothesis to be validated by your own telemetry. |

**Critical framing for engineering:** none of the five platforms publishes numeric per-hour or per-day limits for likes, follows, comments, or DMs on the consumer surface. Every such number in this document is **[PC]** or **[WEAK]**. The only hard, first-party numbers available are (a) X's account limits page, (b) Instagram's 7,500 following cap, (c) API-side publishing quotas for the Instagram Graph API and Threads API, and (d) Meta's strike-ladder durations. Build your rate limiter so the numbers are configuration, not code.

---

## Bottom line — the rules that hold across all five platforms

1. **Consistency of environment beats slowness of activity — and device/IP are graph nodes, not attributes.** Meta's Deep Entity Classification paper publishes the actual entity table, and **Device (direct feature: operating system; neighbours: users sharing the device) and IP Address (direct features: country, reputation; neighbours: registered accounts) are first-class node types** ([USENIX Security '21](https://www.usenix.org/conference/usenixsecurity21/presentation/xu-teng)) **[DOC]**. The paper states verbatim that with IP-derived deep features *"the scripted activity of batch account registration can be easily detected."* TikTok says the same in plainer language: it looks for accounts "operated by the same entity" that "share technical similarities like using the same devices" ([TikTok Newsroom](https://newsroom.tiktok.com/en-eu/how-tiktok-counters-deceptive-behaviour)) **[DOC]**. A perfectly-paced account on a shared IP with a mismatched fingerprint is at more risk than a fast account in a clean, stable, coherent environment.

2. **What is named as violating is *bulk and automation*, not speed per se.** Meta's Spam policy prohibits "posting, sharing, engaging with content or creating accounts … either manually or automatically, at very high frequencies," and adds that restrictions "may apply at lower frequencies when other spam indicators are present" ([Meta Spam policy](https://transparency.meta.com/policies/community-standards/spam/)) **[DOC]**. That last clause is the whole game: your rate budget is not fixed, it is a function of how clean the rest of your signal is.

3. **Automated liking and automated following are explicitly banned everywhere — automated *posting* generally is not.** X: "you may not like posts … in an automated manner" and "may not follow or unfollow X accounts in a bulk, aggressive, or indiscriminate manner" ([X Automation Rules](https://help.x.com/en/rules-and-policies/x-automation), [X Developer Guidelines](https://docs.x.com/developer-guidelines)) **[DOC]**. TikTok prohibits "using automation to run many accounts" and "bots or scripts … to increase likes or shares" ([TikTok Community Guidelines](https://www.tiktok.com/community-guidelines/en/integrity-authenticity)) **[DOC]**. Meta restricts accounts "creating or using an account … through automated means, such as scripting (unless the scripting activity occurs through authorized routes)" ([Meta Account Integrity](https://transparency.meta.com/policies/community-standards/account-integrity/)) **[DOC]**. Meanwhile all four Meta surfaces plus X expose sanctioned publishing APIs. **Engineering consequence:** warmup engagement is the legally/policy-exposed part of your system; posting is the sanctioned part. Design accordingly — and note that scripted engagement is a policy violation on every one of these platforms regardless of how well-paced it is.

4. **Cross-account duplication is a first-class violation signal, separate from rate.** X prohibits "posting identical or substantially similar content … across multiple accounts" and "coordinating to exchange engagement" ([X Platform Manipulation policy](https://help.x.com/en/rules-and-policies/platform-manipulation)) **[DOC]**. Meta names "spam networks [that] create hundreds of accounts to share the same spammy content" ([Meta Newsroom, Apr 2025](https://about.fb.com/news/2025/04/cracking-down-spammy-content-facebook/)) **[DOC]**. For a multi-avatar operation this is the highest-risk structural exposure: **never have two managed accounts engage with each other, follow the same seed set in the same order, or post the same asset.**

5. **New accounts are scored at creation, not after the first post.** Meta: "our detection technology helps us block millions of attempts to create fake accounts every day and detect millions more, often within minutes after creation" ([Meta CSER — Fake Accounts](https://transparency.meta.com/reports/community-standards-enforcement/fake-accounts/facebook/)) **[DOC]**. The DEC deployment removed most abusive accounts "within minutes of registration" ([DEC slides](https://www.usenix.org/system/files/sec21_slides_xu-teng.pdf)) **[DOC]**. TikTok "prevented over 2 billion spam accounts from being created" in 2024 alone ([TikTok content moderation](https://www.tiktok.com/transparency/en/content-moderation/)) **[DOC]**. Warmup cannot rescue a bad registration. **Signup environment quality dominates everything that follows.**

6. **Consumption before production, and profile completion before engagement.** Universal across every practitioner source reviewed: the first sessions are read-only (feed scroll, video watch, search), profile assets go up early, engagement is introduced gradually, and the first post lands roughly at day 6–14 depending on platform ([Multilogin warmup guide](https://multilogin.com/blog/how-to-warm-up-accounts/)) **[PC]**. Nothing in platform documentation confirms this ordering matters — but nothing contradicts it either, and it is the single most consistent claim across vendors.

7. **The recovery protocol is the same everywhere: stop, wait, resume lower.** No platform documents a numeric backoff. Every practitioner source converges on: cease the blocked action class entirely, do not retry (retrying extends blocks) **[PC]**, keep the session alive with passive browsing, resume at roughly half the prior rate. Documented durations exist only for Meta's strike ladder (1/3/7/30 days) ([Meta — restricting accounts](https://transparency.meta.com/enforcement/taking-action/restricting-accounts/)) **[DOC]** and TikTok's 90-day strike expiry ([TikTok Newsroom](https://newsroom.tiktok.com/en-us/supporting-creators-with-an-updated-account-enforcement-system)) **[DOC]**.

8. **One profile ↔ one identity ↔ one IP ↔ one fingerprint, persisted forever.** The only architectural rule every source — platform, vendor, and academic — agrees on. Two corollaries with hard evidence behind them: **never clear cookies** (Meta's `datr` is a 2-year browser identity explicitly described as serving "security and site integrity"; TikTok's `ttwid` is a 1-year identity explicitly for "prevent fraudulent attacks" and "detect non-human traffic") **[DOC]**; and **set `WebRtcIPHandling=disable_non_proxied_udp`**, because STUN runs over UDP outside the HTTP stack and `--proxy-server` does not carry it ([Chrome policy docs](https://chromeenterprise.google/policies/web-rtc-ip-handling/)) **[DOC]**.

9. **Gate the transition from warmup to production on a measured output signal, not a calendar.** No two vendors agree on when the first post is safe — Instagram estimates span day 1 to week 4 — so elapsed days is a poor gate. The better pattern, from [Post Bridge](https://support.post-bridge.com/troubleshooting/how-and-why-to-warm-up-a-new-tiktok-account-before-using-post-bridge) **[PC]**, is to require an observable distribution threshold (their TikTok figure: 500+ average views/post) before scaling. Instagram and Threads expose a first-party equivalent in **Account Status** recommendation eligibility **[DOC]** — poll it rather than inferring shadowbans from engagement.

10. **De-correlate behaviour across your fleet — this is what actually catches networks.** In a peer-reviewed 793,000-video TikTok study ([ICWSM 2026](https://arxiv.org/abs/2505.10867)) **[DOC]**, the signals that detected coordination were **synchronised posting times, reused media assets, and overlapping caption/hashtag sequences**. Transcript similarity and Duet/Stitch signals did *not* detect it. This is orthogonal to proxy and fingerprint hygiene and cannot be fixed by either.

---

# Facebook

## What Facebook actually polices

Meta's Community Standards apply uniformly to "Facebook, Instagram, Messenger and Threads" ([Community Standards preamble](https://transparency.meta.com/policies/community-standards/)) **[DOC]** — so the three Meta sections below share a policy base but differ in enforcement surface and practitioner protocol.

**Named behavioural signals (all [DOC]):**

From the [Spam policy](https://transparency.meta.com/policies/community-standards/spam/):
- "Posting, sharing, engaging with content or creating accounts, Groups, Pages, Events or other assets, either manually or automatically, at very high frequencies."
- Restrictions "may apply at lower frequencies when other spam indicators [are] present."
- Selling, buying or exchanging accounts, Pages, Groups, or admin/moderator roles.
- "Attempting to or successfully selling, buying, or exchanging for engagement, such as likes, shares, views, follows, clicks."
- Engagement bait: "requiring or claiming that users are required to engage with content (e.g., liking, sharing) before they are able to view or interact with promised content."
- Cloaking and deceptive redirects; misleading links; impersonating trusted domains.

From the [Inauthentic Behavior policy](https://transparency.meta.com/policies/community-standards/inauthentic-behavior/):
- Inauthentic behaviour is defined as "deception, performed by a network of inauthentic assets controlled by the same individual or individuals." **The network is the unit of enforcement, not the account.**
- Prohibited: creating/using inauthentic assets to "deceive Meta or our users about the identity, or origin of an audience or the entity that they represent," and to "evade enforcement under the Community Standards."

From the [Account Integrity policy](https://transparency.meta.com/policies/community-standards/account-integrity/):
- Meta may act on accounts that "demonstrate activity or behavior indicative of a clear violating purpose."
- Accounts showing "close linkage with a network of accounts or other entities that violate or evade our policies."
- Accounts "created or repurposed to evade a previous account or entity removal."
- Accounts "creating or using an account or other entity through automated means, such as scripting (unless the scripting activity occurs through authorized routes and does not otherwise violate our policies)."

From [Meta Newsroom, April 2025 — "Cracking Down on Spammy Content on Facebook"](https://about.fb.com/news/2025/04/cracking-down-spammy-content-facebook/):
- Named tactics: "long, distracting captions, often with an inordinate amount of hashtags"; captions "completely unrelated to the content"; spam networks using "hundreds of accounts to share the same spammy content"; coordinated fake engagement in comments.
- Penalties: content "shown to their followers and … not … eligible for monetization"; networks "not … eligible for monetization and may see lower audience reach"; "comments that we detect are coordinated fake engagement will be seen less."
- 2024 figures: "more than 100 Million fake Pages engaging in scripted follows abuse" removed; "over 23 million profiles that were impersonating large content producers" taken down.

From [Meta for Creators — "Combating Unoriginal Content"](https://creators.facebook.com/blog/combating-unoriginal-content):
- ~500,000 accounts actioned for "spammy behavior or fake engagement" in H1 2025; ~10 million impersonator profiles removed.
- Penalties include loss of monetization for a period, reduced distribution of *all* content from the account, and comment demotion.

**Detection methodology (the engineering-relevant part):**
Meta's published system is **Deep Entity Classification** ([USENIX Security '21](https://www.usenix.org/conference/usenixsecurity21/presentation/xu-teng), [slides](https://www.usenix.org/system/files/sec21_slides_xu-teng.pdf)) **[DOC]**:
- **Direct features** are per-entity attributes: for users, age/gender; for Pages, fan count and category; for Groups, member count; **for devices, operating system; for IP addresses, country and reputation.** Note that device and IP are first-class entities in Meta's model.
- **Deep features** are aggregations over the account's graph neighbourhood — e.g. "average group memberships per friend," "most common friend country percentage" — applied recursively to friends-of-friends. Meta generates "tens of thousands of features" this way (widely reported as >20,000, e.g. [MIT Technology Review](https://www.technologyreview.com/2020/03/04/905551/how-facebook-uses-machine-learning-to-detect-fake-accounts/)).
- The stated rationale is adversarial robustness: an attacker can trivially change an account's own attributes but cannot cheaply change the *distribution of properties of its friends' friends*.
- Deployment removed "hundreds of millions of abusive accounts," most "within minutes of registration."

**Engineering consequence:** on Facebook specifically, *who your account is connected to* is a stronger signal than *how fast it acts*. A warmup that builds a plausible, heterogeneous, organically-acquired friend graph is doing the thing DEC actually measures. A warmup that only paces likes is optimising the wrong variable.

## Documented limits

| Limit | Value | Status |
|---|---|---|
| Maximum friends per personal profile | 5,000 | **[PC]** — universally reported and behaviourally verifiable, but no first-party Meta help article was retrievable to confirm it. Treat the number as reliable, the citation as weak. |
| Pending outbound friend requests | ~1,000 | **[WEAK]** — widely repeated, no first-party source found. |
| Strike 1 | Warning only, no restriction | **[DOC]** ([Meta — restricting accounts](https://transparency.meta.com/enforcement/taking-action/restricting-accounts/)) |
| Strikes 2–6 | Time-limited restriction from specific features (e.g. posting in Groups) | **[DOC]** (same) |
| Strike 7 | 1-day restriction from creating content | **[DOC]** (same) |
| Strike 8 | 3-day restriction from creating content | **[DOC]** (same) |
| Strike 9 | 7-day restriction from creating content | **[DOC]** (same) |
| Strike 10+ | 30-day restriction from creating content | **[DOC]** (same) |
| Strike expiry | All strikes expire after 1 year; violations older than 90 days generally not counted (4 years for severe categories) | **[DOC]** ([counting strikes](https://transparency.meta.com/enforcement/taking-action/counting-strikes/)) |
| Graph API — Pages | `Calls within 24 hours = 4800 × Number of Engaged Users` | **[DOC]** ([Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)) |
| Graph API — app level | `Calls within one hour = 200 × Number of Users` | **[DOC]** (same) |

There is **no published Facebook limit** for likes/hour, comments/hour, friend requests/day, Group joins/day, or posts/day on the consumer surface. Any such number you encounter is **[PC]**.

**Note on the strike ladder:** it applies to *content* violations. Spam/inauthenticity enforcement on a warmup account is more likely to arrive as an unannounced feature block, a checkpoint (ID/photo/phone verification), or outright disable — not as a visible strike. Meta also offers first-strike removal via a "brief educational exercise" ([Transparency Center](https://transparency.meta.com/governance/tracking-impact/creating-opportunities-to-remove-strikes/)) **[DOC]**.

## Account prerequisites

- **Minimum age 13** **[DOC]** (Meta terms; also stated across Meta help surfaces).
- **Email *or* phone at signup** — Facebook accepts either; a phone number is not universally mandatory at registration **[PC]** (no retrievable first-party statement; consistent across signup-flow documentation). Meta "may request information" for accounts suspected of automated creation ([Account Integrity](https://transparency.meta.com/policies/community-standards/account-integrity/)) **[DOC]** — in practice this is the checkpoint mechanism.
- **A personal profile is required before creating a Page** **[PC]**.
- Practitioner emphasis: leave the profile *incomplete* at first. "Leave some fields empty. Perfect profiles scream 'fake account'" ([Multilogin](https://multilogin.com/blog/how-to-warm-up-a-facebook-account/)) **[PC]**. This is plausible against DEC's direct-feature model but unverified.

## Facebook warmup schedule — practitioner consensus, undocumented

**Facebook is the longest and hardest warmup of the five.** Multilogin rates it 14–21 days at "difficulty: High," the longest in their platform table ([Multilogin](https://multilogin.com/blog/how-to-warm-up-a-facebook-account/)) **[PC]**. Every source agrees running ads on a "cold" Facebook account is near-certain death.

### Primary schedule — Multilogin, 4 weeks (updated Mar 2026)

[Source](https://multilogin.com/blog/how-to-warm-up-a-facebook-account/). **All numbers [PC].**

| Period | Sessions/day | Duration | Likes | Friend requests | Comments | Groups | Posts |
|---|---|---|---|---|---|---|---|
| **Days 1–3** | **2–3 logins**, 5–10 min scroll each | 10–15 min/day total | max 2–3/day | **0** | **0** | **0** | none |
| **Week 2** | 2–3 | 15–20 min/day | 3–5/session | 2–3/day | 1–2/day — substantive, **never single emojis** | join **1–2 only** | none |
| **Week 3** | 2–3 | 20–30 min/day | 8–10/day | 5–6/day | 3–4/day | — | **first original post — personal, non-business** |
| **Week 4** | 2–3 | 20–30 min/day | — | 8–10/day | — | — | **2–3×/week** |

Ads Manager connection safe only after **≥14 days**, preferably 21. **Add profile photo and cover photo on separate days, several days apart — not simultaneously** (Multilogin explicit; corroborated by mybid.io and the Dolphin Anty cluster).

### Alternative — spy.house / HexaProxy 14-day 4G playbook (May 2026)

[Source](https://spy.house/blog/account-farming-with-4g-mobile-proxies-a-14-day-warm-up-playbook-for-facebook-tiktok-ads). The only Facebook source giving both session counts and minutes, and the only one that carries the ramp through to ad spend. **[PC]**

| Day | Actions |
|---|---|
| 1–2 | **1 login/day max, 5–10 min.** Like 2–3 posts. View competitor ads. **Do not open Ads Manager.** |
| 3–5 | 10–15 min/day. Add profile pic + bio. Follow 5–10 Pages. 1–2 comments or messages. **Payment method day 5 only, geo-matched to IP.** |
| 6 | Create Facebook Page |
| 7 | Open Ads Manager — **navigation only, 5 minutes** |
| 8 | First campaign at **$5–10/day**, soft creative |
| 9–11 | Budget increase **max 30%/day** |
| 12–14 | Stable at **$50–100/day** |

*"One account = one dedicated SIM. Always."* No shared IPs during warmup.

### Other schedules and where they disagree

- **[Undetectable](https://undetectable.io/blog/facebook-account-farming-guide/)** (Mar 2023 — **stale, flagged**): ≤25 likes/day, ≤5 reposts; 2–5 initial friends; create account day 1 then **log out for a full day**; Fan Page day 7; Business Manager week 2; card link days 10–14; **minimum 1 month** before campaigns.
- **[IPFoxy](https://www.ipfoxy.com/blog/ideas-inspiration/5458)** (2026): day 1 = 15–20 min browse + verify email/phone, then log out; day 2 = 15–30 min, add **1–2 friends**; day 3 complete profile gradually; day 4 join 1–2 Groups, add **5–10 friends**; days 8–14 create public Page.
- **Dolphin Anty cluster / accs-center**: much faster — likes 5–10 and 2–3 Groups on days 1–2, photo + cover both on day 3–4, payment method and a **$5–10 boosted post on day 7**.
- **BHW consensus (2025–26)**: 7–14 days of scroll/like/join/watch before ads; engagement-objective campaigns first at $10/day for 3–5 days, then +20%/24h or +20–30% every 3–4 days.

**Widest disagreements:**
| Question | Range across sources |
|---|---|
| Total warmup before ads | **7 days** (accs-center/Dolphin) → **14 days** (Multilogin, BHW) → **30 days** (Undetectable) |
| First original post | **day 3–5** (Dolphin cluster, BHW) → **week 3** (Multilogin) |
| Friend requests in week 1 | **"avoid entirely"** (Multilogin) → **5–10/day from day 4** (IPFoxy) |
| Payment method | **day 5** (spy.house) → **days 10–14** (Undetectable) |
| Daily likes ceiling | **2–3/day** (Multilogin wk 1) → **25/day** (Undetectable) |

**Recommended default:** Multilogin's 4-week social table for the persona side; spy.house's 14-day table if and when the account touches ads. Adopt the conservative reading on friend requests.

### Facebook-specific ritual: pre-registration cookie warming

Uniquely emphasised for Facebook across Multilogin (CookieRobot), AdsPower (Cookie Robot), GoLogin ("5–30 min gathering cookies before registering") and mybid.io (*"20–30 pages at varying intervals, 10–15 min per page,"* then *"let the account rest 1–2 days"*) **[PC]**. The claim is that a browser profile with zero browsing history at the moment of Facebook registration is itself a signal. Unverified against any Meta source, but it is cheap to implement and is one of the few practices that is Facebook-specific rather than copied across platforms.

### Facebook numeric caps — heavily stale, read the warning

⚠️ **Nearly every hard Facebook cap in circulation traces to a single [Elfsight article dated 20 August 2020](https://elfsight.com/blog/facebook-limits-and-blocks-avoiding-account-bans/)** — six years old, predating multiple enforcement regimes. Reproduced for completeness only. **[WEAK]**

| Action | Cited limit | Cited block |
|---|---|---|
| Pending friend requests | 1,000 simultaneous | — |
| Friend-add checkpoint | — | 30–60 min |
| Mass follows | 400–450 → ID verification | — |
| Group invites | 600 | 12 h, escalating |
| Page invites | 2,000–2,500 | 12–24 h |
| Group/Page joins | **25/day** | **2-week ban** |
| DMs | 150 at once; forward max 5 recipients | — |
| Posting-ban ladder | — | 24 h → 3 days → 1 week |
| Accounts per IP | 10 max | IP block 24–72 h |

Newer but weakly-sourced: **≤3–5 posts/hour for new accounts** ([Adsterra, May 2026](https://adsterra.com/blog/facebook-jail/)); ~20 friend requests/day practical; accepting 30–40 requests/day reported to trigger 48-hour blocks. **Joining 20+ Groups on a fresh account** is named as an instant-suspension behaviour for 2026 **[WEAK]**.

**Genuinely not found:** Facebook likes/hour, comments/day, or DMs/day for new accounts from any 2024–2026 source; and any friend-count threshold that must be reached before the first post. If your design depends on either, you must measure it.

## Soft ban / action block, and recovery

| Symptom | What it is | Duration | Recovery |
|---|---|---|---|
| Feature block / "Facebook Jail" | Rate/spam-triggered restriction on one action class | **A few hours to 30 days**; new accounts typically **several hours to a week** ([Adsterra, May 2026](https://adsterra.com/blog/facebook-jail/)) **[PC]**. Legacy escalation ladder 24 h → 3 days → 1 week **[WEAK, 2020 source]** | Stop that action class entirely. Keep logging in and passively browsing. Resume at ~50% of prior rate. Check the **Account Quality** dashboard and submit "Request Review"; **do not attempt workarounds while waiting** — consensus is Facebook will not unblock early. |
| Ad account disable | Ads-side enforcement | *"After about 4–5 days the ad account usually comes back"* ([Dolphin Anty, May 2026](https://dolphin-anty.com/blog/en/facebook-accounts/)) **[PC]** | Restart spend at **≤$5/day**, ramp again slowly. |
| Checkpoint (photo/ID/phone verification) | Meta "request[ing] information" per [Account Integrity](https://transparency.meta.com/policies/community-standards/account-integrity/) **[DOC]** | Until satisfied | Complete from the *same* profile and IP. A checkpoint answered from a different IP/fingerprint is the classic way accounts die. |
| Strike restriction | Content-violation ladder | 1 / 3 / 7 / 30 days by strike count **[DOC]** | Wait it out; appeal or take the educational exercise for a first strike **[DOC]** |
| Disable | Terminal | Permanent unless appealed | On-screen appeal flow **[DOC]** |

---

# Instagram

## What Instagram actually polices

Instagram is governed by the same [Meta Community Standards](https://transparency.meta.com/policies/community-standards/) **[DOC]** — Spam, Inauthentic Behavior, Account Integrity as quoted in the Facebook section. Instagram-specific additions:

- **Recommendation eligibility is a separate, softer enforcement layer.** Instagram's Account Status shows "if your account's content can be recommended" across "Explore, Reels, Feed Recommendations, Search, and Suggested Accounts," and shows "a sample of content or components of your profile that may go against our Recommendations Guidelines" ([Instagram announcement](https://about.instagram.com/blog/announcements/instagram-outages-and-account-status), [help article](https://help.instagram.com/653964212890722)) **[DOC]**. This is the concrete, checkable definition of what people call a "shadowban" — **it is a real, first-party, queryable account state, and your warmup system should read it.**
- **Instagram may restrict features** "if it appears that the account is not following Community Guidelines or our Terms of Use" ([Instagram](https://about.instagram.com/blog/announcements/instagram-outages-and-account-status)) **[DOC]** — commenting, messaging and Live are named as restrictable.
- **Hashtag stuffing is now structurally prevented.** As of 18 December 2025, Instagram caps posts and Reels at **5 hashtags** (down from 30) ([Social Media Today](https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/)) **[DOC — reported, with Instagram's stated rationale]**. Mosseri framed the change as focusing tags "more on communities and less on engagement hacking." Any warmup or posting template carrying 15–30 tags is now both ineffective and an explicit spam tell.

## Documented limits

| Limit | Value | Status |
|---|---|---|
| Maximum accounts you can follow | **7,500** — "To help reduce spam, Instagram doesn't allow anyone to follow more than 7,500 people." | **[DOC]** ([help.instagram.com/408167069251249](https://help.instagram.com/408167069251249/)) |
| Hashtags per post/Reel | 5 | **[DOC]** (Dec 2025, see above) |
| API-published posts per account | "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period." Carousels count as one post. | **[DOC]** ([content publishing docs](https://developers.facebook.com/docs/instagram-platform/content-publishing)) |
| Carousel items | 10 max | **[DOC]** (same) |
| Graph API (non-messaging) | `Calls within 24 hours = 4800 × Number of Impressions` per app-user pair, rolling | **[DOC]** ([rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)) |
| Messaging — Send API | 100 calls/sec text & links; 10 calls/sec media | **[DOC]** (same) |
| Strike ladder | Same Meta ladder as Facebook (1/3/7/30 days) | **[DOC]** ([restricting accounts](https://transparency.meta.com/enforcement/taking-action/restricting-accounts/)) |
| Likes / follows / comments / DMs per hour or day | **Not published. Instagram documents no numeric action limits at all.** | — |

**The commonly-cited Instagram numbers are all [PC]:** ~60 follows/hour, ~150 likes/hour, ~60 comments/hour, 150–200 follows/day, 400–1,000 likes/day. These figures circulate across proxy/anti-detect vendor blogs ([Proxidize](https://proxidize.com/blog/instagram-action-block/), [IPRoyal](https://iproyal.com/blog/instagram-action-block/), [Decodo](https://decodo.com/blog/instagram-action-block), [Evomi](https://evomi.com/blog/instagram-action-block-fix)) with no first-party basis and considerable disagreement. **Do not hardcode them.** They are also almost certainly account-age- and trust-dependent rather than global constants.

## Account prerequisites

- **Minimum age 13** **[DOC]**.
- **Phone verification at signup:** multiple vendor sources assert that as of 2026 Instagram requires a phone number for all new signups and no longer accepts email-only registration ([Multilogin](https://multilogin.com/blog/how-to-multiple-instagram-accounts-without-a-phone-number/), SMS-verification vendors). **[WEAK]** — these are self-interested sources (they sell virtual numbers), and no first-party Meta statement was found. **Validate empirically before designing around it.** What *is* documented is that Meta may request information from accounts suspected of automated creation ([Account Integrity](https://transparency.meta.com/policies/community-standards/account-integrity/)) **[DOC]**.
- Disabled accounts: "Accounts that don't follow our Community Standards may be disabled"; appeal is via the in-app on-screen flow ([help.instagram.com/366993040048856](https://help.instagram.com/366993040048856)) **[DOC]**.
- **Surface matters.** Instagram Stories cannot be created from desktop web; the desktop Create menu never offers "Story." Desktop also lacks the audio library, AR filters, multi-clip editing, stickers/polls, and Shopping features **[PC]**, though feed photos, videos, carousels, Reels and Live are supported. **A desktop-web-only warmup cannot perform Story views/posts, which practitioners consider a core warmup signal.**

## Instagram warmup schedule — practitioner consensus, undocumented

Instagram has the richest practitioner literature of the five, and also the widest internal disagreement. **All numbers below [PC].**

### Recommended skeleton — BHW / ToyBox Marketing, 18 days (Apr 2025)

[Source](https://www.blackhatworld.com/seo/the-instagram-warm-up-guide-real-device-automation.1703485/). **This is the most engineering-usable artifact found in the entire practitioner corpus** — it is the only schedule with deliberate rest days, explicit profile-mutation handling, and post-warmup steady-state caps.

| Day | Action |
|---|---|
| 1 | Login + 10–15 Story views |
| 2–4 | Story views only, 10–15/day |
| 5 | **Username change** + Story views — **rotate proxy for this action** |
| 6 | **Display-name change** + Story views — **rotate proxy** |
| 7 | **Bio + profile picture + first photo upload** — **rotate proxy** |
| 8 | 5 follows |
| 9 | 6 follows |
| **10–11** | **Rest days — zero activity** |
| 12 | 7 follows |
| 13 | 8 follows |
| 14 | 9 follows |
| 15 | 10 follows |
| **16** | Rest + **add bio link** — **rotate proxy** |
| **17** | Rest |
| 18 | Warmed |

**Post-warmup steady-state caps from the same source:** follows 4–6/hr, 20–30/day · unfollows 8–12/hr, 20–30/day · likes 10–15/hr, 70–90/day · comments 2–3/hr, 5–10/day · DMs to new followers 3–5/hr, 10–15/day.

**Two design ideas worth stealing from this schedule even if you reject its pacing:**
1. **Action-class-dependent IP handling.** Story views can tolerate a shared/stable IP; **profile mutations (username, display name, bio, avatar, bio link) get a fresh IP.** No other source in the corpus makes this distinction. Single-source **[WEAK]**, but cheap to implement and coherent with Meta's device/IP-as-entity model.
2. **Deliberate zero-activity rest days.** Only schedule in the corpus that builds in gaps. Real users have days off; a perfectly-daily account does not.

### Alternative schedules — the honest spread

| Source | Length | Day 1 | First post | Character |
|---|---|---|---|---|
| [ToyBox/BHW](https://www.blackhatworld.com/seo/the-instagram-warm-up-guide-real-device-automation.1703485/) | 18 d | 10–15 Story views | **never in schedule** | Most conservative |
| [Multilogin (mobile)](https://multilogin.com/blog/mobile/how-to-warm-up-instagram-account/) | 3–4 wk | 15–20 min, 5–8 likes, **no follows/comments** | **week 3–4** | Very conservative |
| [Conbersa](https://www.conbersa.ai/learn/how-to-warm-up-instagram-accounts) | 7–10 d | 15–30 min, **zero write actions** | **day 7–10** | Middle |
| [360uniquizer](https://360uniquizer.com/en/news/instagram-account-warmup-2026) | 14 d | register + 20–30 min scroll | **day 5–6** (Reel) | Middle |
| [shadowphone](https://www.shadowphone.io/blog/instagram-account-warm-up-guide-2026) | 14 d | **1 post + 5 follows** | **day 1** | Aggressive |
| [Multilogin (blog)](https://multilogin.com/blog/how-to-warm-up-accounts/) | 10–14 d | 15–20 likes, 10–15 follows, 5–7 comments | day 6–10 | Aggressive |

**⚠️ Multilogin contradicts itself.** Its [general warmup guide](https://multilogin.com/blog/how-to-warm-up-accounts/) (2 Jul 2026) prescribes Instagram days 1–5 at **15–20 likes, 10–15 follows, 5–7 comments per day**. Its [Instagram-specific guide](https://multilogin.com/blog/mobile/how-to-warm-up-instagram-account/) (10 Jul 2026) prescribes week 1 at **5–8 likes per session and zero follows, zero comments**. Eight days apart, roughly 3× apart in aggression, from the same vendor, with no reconciliation. **Treat all Multilogin numbers as illustrative, not measured.**

**The single widest disagreement in this entire research is when the first Instagram post is safe:** day 1 → day 5–6 → day 7–10 → week 3–4 → never-in-an-18-day-schedule. There is no consensus. **Default to day 7–10** as the median defensible position, and gate on account health signals rather than elapsed days.

### Detailed mid-range option — shadowphone 14-day (Jan 2026)

| Days | Posts | Likes | Comments | Follows | Stories | Session |
|---|---|---|---|---|---|---|
| 1–2 | 1 | — | — | 5 | 15 min browsing | 30 min |
| 3–4 | 1 | 10 | 3 | 5 | 10 watched | 30 min |
| 5–7 | 1–2 | 20 | 5 | 10 | 1 posted | 45 min |
| 8–10 | 2–3 | 30 | 10 | 15 | 2 | 45 min |
| 11–14 | 1–2 | 50 | 15 | 20 | DM replies | 60 min |

Its accompanying **caps-by-account-age table** — explicitly disclaimed by its own author as "an operator worksheet, not a safe-limit table" **[PC]**:

| Account age | Follows/day | Likes/day | Comments/day | DMs/day |
|---|---|---|---|---|
| 0–3 days | 5–10 | 10–20 | 3–5 | **0** |
| 3–7 days | 10–20 | 30–50 | 5–10 | 5 |
| 1–2 weeks | 20–40 | 50–100 | 10–20 | 10 |
| 2–4 weeks | 40–80 | 100–200 | 20–40 | 15 |
| 1+ month | 100–150 | 300–500 | 50–80 | 20–30 |

### Cleanest new-account ramp spec found

[GeeLark](https://www.geelark.com/glossary/instagram-action-blocks/) (Nov 2025) **[PC]**: **first 72 hours = max 20 actions/day with 80% of session time as passive browsing**; days 4–14 ramp to **50 actions/day**. Also: rotate action *types* hourly (like → comment → browse), schedule a **12-hour rest period weekly**, keep follow/unfollow churn under 1%. ⚠️ Same page carries unsourced statistics ("68% of social media managers…") that are marketing — use the ramp, discount the stats.

### Instagram cap figures in circulation — and why to distrust them

**Sources disagree by up to 6×.** Likes/hour is cited as 20 ([Elfsight](https://elfsight.com/blog/instagram-restrictions-limits-likes-followers-comments/)), 120 ([Boostfluence](https://www.boostfluence.com/blog/limit-subscription-instagram)), and 10–15 (ToyBox/BHW). Follows/day is cited as 20–30 (ToyBox), 30–50 for new accounts ([Conbersa](https://www.conbersa.ai/learn/platform-rate-limit-safety-thresholds)), ~150 (GeeLark, Boostfluence). Combined actions/day is cited as 150 (BHW practitioner) to 500–750 (Conbersa).

⚠️ **The "classic Instagram limits canon"** — 120 likes/hr, 12–14 comments/hr at 350–400 s intervals, 60 s unfollow interval — appears near-verbatim across Elfsight, Boostfluence, Socifly and dozens more. It traces to **2019–2021 Instagress/Jarvee-era folklore**. It is internally consistent across sources *because they copied each other, not because anyone measured it.* The 7,500 following cap in that canon is real and platform-published **[DOC]**; the hourly action numbers are not.

**The two most defensible numbers**, because they are *tool-enforced* rather than opinion — [PhantomBuster](https://support.phantombuster.com/hc/en-us/articles/26971108136722-How-to-Use-the-Instagram-Auto-Follow) caps its own Instagram Auto Follow at **40 profiles/hour** and its [Auto Commenter](https://support.phantombuster.com/hc/en-us/articles/26971112434194-How-to-Use-the-Instagram-Auto-Commenter) at **80 comments/day**. A vendor that eats its own bans has more skin in the game than a blog.

**One genuinely new 2026 restriction worth designing around:** automated DMs triggered by comments or Story replies are limited to **1 per user per 24 hours**, and private replies to comments to **750/hour** ([CreatorFlow](https://creatorflow.so/blog/instagram-dm-compliance-meta-rules/), Jul 2026) **[PC]** — relevant if you ever build DM automation.

### Profile completion timing — where sources conflict hardest

| Element | ToyBox/BHW | 360uniquizer | Multilogin | Conbersa |
|---|---|---|---|---|
| Avatar | **Day 7** | Day 1 | At creation | — |
| Bio text | **Day 7** | Day 1, neutral, no link | At creation | — |
| Username change | **Day 5** (rotate proxy) | — | — | — |
| Display name | **Day 6** (rotate proxy) | — | — | — |
| **Bio link** | **Day 16** | **Day 8–10 earliest** | — | after day 7–10 |

**Universal agreement on one point: the bio link is the last profile element added, always.** Everything else is contested.

**Instagram enforces a 14-day cooldown between username changes** (universally repeated, treat as real) **[PC]**. Practical rule: **set the username once, early, and never touch it again.**

### Ordering consensus [PC]

scroll → watch-to-completion → **Story views** → likes → follows → saves → search queries → comments → first post → bio link → **DMs last**. DMs are the highest-risk Instagram action class and appear in no schedule before day 10.

### Instagram-specific quirks practitioners emphasise

- **Mobile-first bias.** GeeLark: *"Instagram's algorithm, designed for a mobile-first experience, treats fresh accounts on unfamiliar devices with extreme suspicion."* Nobody quantifies a desktop-vs-mobile limit delta — **not found**.
- **Account switcher caps at 5 accounts per device**, and more than 2 per device adds correlation risk ([VoidMob](https://voidmob.com/blog/run-multiple-instagram-accounts-without-flags-2026), Jun 2026) **[PC]**.
- **A 1–3 month new-account "probation" of low distribution** while Meta builds a trust score (VoidMob) **[WEAK]** — but it explains the "0 views" panic on fresh accounts and argues against over-diagnosing early shadowbans.
- Instagram is rated **the strictest of the five with the most false positives** ([ssemble](https://www.ssemble.com/blog/account-warmup-guide-2026), Jun 2026).
- BHW consensus: **static/sticky proxies beat rotating**; same device + IP throughout.

## Soft ban / action block, and recovery

The "Action Blocked" state — "This action was blocked. Please try again later. We restrict certain content and actions to protect our community" — is the canonical Instagram warmup failure **[PC]**.

**Durations [PC], sources broadly agree:**
| Variant | Duration | Source |
|---|---|---|
| Temporary, no expiry shown | up to 24 h | [IPRoyal](https://iproyal.com/blog/instagram-action-block/) |
| With visible expiry date | 24–48 h | IPRoyal; [GeeLark](https://www.geelark.com/glossary/instagram-action-blocks/) |
| **Undated block** | **several hours to two weeks** | IPRoyal (repeated widely) |
| Repeat violations | 7+ days | GeeLark |
| Light/first offence | 2–3 h escalating to 1–5 days | [Elfsight](https://elfsight.com/blog/instagram-restrictions-limits-likes-followers-comments/) |

**Staged recovery ramp** — the only quantified one found ([GeeLark](https://www.geelark.com/glossary/instagram-action-blocks/)) **[PC]**:
- **First 24 h: complete inactivity.**
- Days 2–3: **25%** of normal volume.
- Days 4–7: **50%**.
- Then normal. IPRoyal separately recommends 1–3 days fully off-platform.

**Universal rules [PC]:** stop the blocked action class completely; **never retry — retrying is universally reported to extend the block**; disconnect third-party tools/OAuth apps; keep passively using the account (scroll, watch Stories) from the *same* IP and profile.

**Shadowban (reach suppression) is a different state from an action block.**
- **Detection is documented and checkable:** poll **Account Status** for recommendation eligibility ([Instagram](https://about.instagram.com/blog/announcements/instagram-outages-and-account-status)) **[DOC]**. Do not infer shadowbans from engagement drops alone.
- Practitioner duration estimates ([Inflowave](https://inflowave.io/resources/instagram-shadowban-2026-complete-guide), Apr 2026) **[WEAK — unverifiable methodology, self-reported]**: light (one banned hashtag) **3–7 days**, sometimes <72 h; median **14 days**; heavy **21–30 days**; with active recovery **4–7 days**.
- Practitioner detection thresholds: engagement collapse of **40–70%** with no other change; Story views down **30–50%**. Other sources cite 80–95% for a hard shadowban.

**Inflowave's 14-day recovery ladder** — structurally the most implementable in the corpus even though its statistics are soft **[PC]**:

| Days | Action |
|---|---|
| 1–2 | Full automation pause |
| 3–5 | One organic Story/day only |
| 6–9 | Half volume: 1 feed post/day, **no hashtags** |
| 10 | Re-enable DM auto-responses only |
| 12 | Re-enable comment triggers, new posts only |
| 14 | Re-enable scheduled posts, capped 1/day for a further week |
| 21+ | Normal operation **only if reach ≥80% of baseline**; otherwise extend 14 more days |

Also widely cited: strip hashtags from the last ~9 posts (caption *and* first comment); jitter posting cadence **±20 min**; use **5–8 niche hashtags under 100k uses** — note this last one is now moot given Instagram's documented 5-hashtag cap **[DOC]**.

**Bio-link blocks:** repeatedly changing the bio link in a short window is reported to trigger a 24–72 h link-clickability block **[PC]**.

---

# Threads

Threads is the most under-documented of the five and the most structurally distinctive: it is not an independent account system.

## What Threads actually polices

- Threads is **explicitly named** in the [Meta Community Standards preamble](https://transparency.meta.com/policies/community-standards/) alongside Facebook, Instagram and Messenger **[DOC]**. So the entire Spam / Inauthentic Behavior / Account Integrity corpus quoted in the Facebook section applies verbatim to Threads — including "posting, sharing, engaging with content … at very high frequencies," and the network-level definition of inauthentic behaviour.
- Threads-relevant spam behaviours named in Meta's Spam policy: high-frequency posting and engagement, repetitive content, engagement bait, cloaked/misleading links **[DOC]**.
- Practitioner-observed additions specific to Threads: repeating similar replies across many creators' threads, reposting without commentary, and engagement-bait phrasing ("comment YES if…") ([Postory](https://postory.io/blog/threads-shadowban)) **[PC]**.

## Documented limits

| Limit | Value | Status |
|---|---|---|
| Threads API — posts | "Threads profiles are limited to **250** API-published posts within a 24-hour moving period." | **[DOC]** ([Threads API overview](https://developers.facebook.com/documentation/threads/overview)) |
| Threads API — replies | "Threads profiles are limited to **1,000** replies within a 24-hour moving period." | **[DOC]** (same) |
| Quota introspection | `GET /{threads-user-id}/threads_publishing_limit` returns `quota_usage`, `reply_quota_usage`, `quota_total`, `quota_duration` | **[DOC]** (same) |
| Re-signup after deletion | "After your Threads account is deleted, you will have to wait **90 days** before you can sign up again with the same Instagram account." | **[DOC]** ([Instagram Help](https://www.facebook.com/help/instagram/313703828012423)) |
| Re-signup after enforcement | If removed for violating Community Standards, "you may not be able to sign up again with the same Instagram or Facebook account." | **[DOC]** (same) |
| Consumer-surface action limits | Not published. | — |

**The 250 posts / 1,000 replies figures are the single most useful documented numbers for Threads.** They are API-side, so they are a ceiling on *sanctioned* volume, not a safe warmup target — but they tell you where Meta itself considers the boundary of legitimate automated use to be.

## Account prerequisites — the Instagram dependency

This is the load-bearing fact for your architecture:

- **A Threads profile normally requires an Instagram account.** Handle and display name are inherited from Instagram **[DOC/PC — universally documented in Meta's own product surfaces and reporting]**. Outside the EU there is no standalone signup path.
- **EU exception:** Meta has been testing standalone Threads signup (email or phone, no Instagram) for EU users, driven by DMA obligations ([Bloomberg](https://www.bloomberg.com/news/articles/2023-12-14/meta-lets-eu-users-sign-up-to-threads-without-an-instagram-link), [Social Media Today](https://www.socialmediatoday.com/news/threads-account-creation-separate-instagram/748530/)) **[DOC — reported]**. Also, EU users are offered "Use Threads without a profile" as a browse-only mode.
- **Deletion is now decoupled but asymmetric:** "Deleting your Threads account won't also delete your Instagram or Facebook account" ([Instagram Help](https://www.facebook.com/help/instagram/313703828012423)) **[DOC]** — this changed in November 2023; earlier reporting saying otherwise ([TechCrunch, Jul 2023](https://techcrunch.com/2023/07/06/threads-delete-profile-instagram-meta/)) is obsolete.
- **Enforcement flows downhill.** If the Instagram (or Facebook) account used to create the Threads profile is disabled, the Threads account is disabled with it ([Geelark](https://www.geelark.com/blog/threads-account-banned/)) **[PC, consistent with Meta's linked-entity model]**.

**Engineering consequences:**
1. **Threads account age = Instagram account age.** There is no independent Threads warmup clock. A Threads profile created on top of a 6-month-old, well-warmed Instagram account starts from that Instagram account's trust, not from zero.
2. **Warm Instagram first, then activate Threads.** Do not treat Threads as a separate warmup track requiring its own 14 days of read-only activity. The correct sequencing is: warm Instagram → activate Threads on the same profile/proxy → ramp Threads posting.
3. **Threads shares the Instagram session, cookies and device identity.** One browser profile must serve both. Splitting Instagram and Threads for the same avatar across two profiles or two IPs is a self-inflicted linkage anomaly.
4. **The 90-day re-signup cooldown means a deleted Threads profile is not cheaply recoverable** — treat Threads deletion as destructive to that avatar's Threads presence for a quarter.

## Threads warmup schedule — practitioner consensus, undocumented

**⚠️ Read this caveat first: no vendor, agency, or operator publishes a day-by-day Threads warmup schedule.** This was searched five separate ways across the anti-detect browser, proxy, and automation-tooling ecosystems, and the result is a confirmed absence. Threads is the least-covered platform in the entire practitioner corpus. The table below is therefore the weakest artifact in this document — extrapolated from the Instagram protocol, constrained by Meta's documented API quotas, and informed by only two Threads-specific sources ([Postory](https://postory.io/blog/threads-shadowban), [Geelark](https://www.geelark.com/blog/threads-account-banned/)). **[PC]/[WEAK]**

**The one piece of genuinely Threads-specific timing advice found anywhere** is from Post Bridge's growth guide **[WEAK — single source, retrieved via search index]**:

> **"Decline the Threads link at signup. Connecting Threads on day one tends to weaken early warm-up, so skip it for now."**

That is directly actionable: **do not auto-enable Threads when creating the Instagram account.** Activate later, once the Instagram account has trust. No source names a specific activation day; **day 14–21 is a defensible default but it is an inference, not a citation.**

The only steady-state Threads cadence numbers found anywhere: **2–3 original posts + 10–20 strategic replies per day**, or **14–21 posts and 50–70 replies per week**, with a critical **30–90 minute engagement window** after publishing ([Replia](https://replia.net/blog/threads-automation-guide), Apr 2026). ⚠️ The same source carries obvious marketing statistics ("+47% growth uplift," "3.2× more consistent") — take the cadence, discard the claims. Practitioner ceilings of ~20 posts/day and 50–100 comments/day are **[WEAK]** (one traces to a single individual's Threads post). **Follows/day, likes/day and DMs/day for Threads: not found.**

Also: exactly **one Threads profile per Instagram account (1:1)**; the mobile app allows 5 Instagram accounts logged in simultaneously ([Multilogin](https://multilogin.com/blog/can-i-have-multiple-threads-accounts/), Jan 2026) **[PC]**.

Schedule assumes the parent Instagram account is already ≥14 days warmed.

| Days (from Threads activation) | Sessions/day | Session length | Actions |
|---|---|---|---|
| **1–2** | 1–2 | 10–15 min | Activate profile (inherits IG avatar/bio). Scroll For You and Following feeds. Follow 5–10 accounts. No posting, no replies. |
| **3–5** | 2 | 10–20 min | Likes 10–20/day. Replies 2–5/day, substantive and *distinct from each other*. Follow 5–10/day. |
| **6–8** | 2 | 15–25 min | **First post: day 6–8.** Text-only or single image. Replies 5–10/day. Continue likes/follows. |
| **9–14** | 2–3 | 20–30 min | 1 post/day. Replies 10–15/day. Reposts *with commentary only* — bare reposts are a named trigger **[PC]**. |
| **15–30** | 2–3 | 20–30 min | Ramp to 2–3 posts/day. Keep total daily posts well under the documented 250/24 h API ceiling — practitioners run an order of magnitude below it. |

**Named Threads triggers [PC]:** bulk following/unfollowing (Postory cites a "60 to 200 follows per hour" range as the trigger band — note this is a *trigger* range, not a safe range), duplicate replies across threads, engagement-bait phrasing, reposting without commentary, and high-volume political content. New accounts are said to face "tighter thresholds" in their first few weeks ([Postory](https://postory.io/blog/threads-shadowban)) **[WEAK]**.

## Soft ban and recovery

- **Detection is documented and checkable:** Threads/Instagram Account Status will report whether the account is eligible to be recommended, and will show a "Content lowered in feed" notice **[DOC]** (Account Status is a first-party Meta surface). Practitioners supplement with a logged-out incognito search for the exact @handle **[PC]**.
- **Duration [PC]:** "Most Threads shadow bans last 7 to 14 days if you stop the flagged behavior" ([Postory](https://postory.io/blog/threads-shadowban)).
- **Recovery [PC]:** a 48-hour posting break "to reset your activity signature," then resume with original, non-templated content at reduced volume.
- **Appeal is one-shot.** Geelark reports that a disabled Threads account gets a single appeal opportunity, after which the disable is permanent **[WEAK — single source]**. Given the 90-day re-signup cooldown, treat Threads appeals as non-renewable and do not burn them on ambiguous cases.

---

# X (Twitter)

X is the best-documented of the five for hard limits and the most explicit about automation.

## What X actually polices

From the [Platform Manipulation and Spam Policy](https://help.x.com/en/rules-and-policies/platform-manipulation) — every item below is a **named signal**, all **[DOC]**:

**Inauthentic accounts:**
- "Unauthorized automation: Automated or scripted accounts that do not comply with our Developer Policy."
- Fake personas using "stock, stolen or AI-generated profile photos." **This directly implicates AI-generated avatars — a common multi-avatar shortcut.**

**Multiple accounts / coordination:**
- Creating multiple accounts to "boost" trending topics or hashtags.
- Operating accounts that "engage with the same posts, accounts, or polls."
- Cross-posting identical content across multiple accounts.
- "Circumventing account creation technical limits."

**Content spam:**
- "Sending bulk, aggressive, high-volume unsolicited replies, mentions, or direct messages."
- "Excessive, unrelated hashtags."
- Repeatedly posting identical content ("Copypasta").

**Engagement spam:**
- "Follow churn" — "following then unfollowing accounts in an effort to inflate one's own follower count." **This kills the classic follow/unfollow warmup loop outright.**
- "Indiscriminate following" of large numbers of unrelated accounts.
- "Coordinating to exchange engagement in any X features."
- Trading or selling accounts and engagement metrics.
- Using automation to drive traffic artificially.

From the [X Rules and best practices](https://help.x.com/en/rules-and-policies/x-rules-and-best-practices) **[DOC]**:
- "Aggressively or indiscriminately following hundreds of accounts to get attention" is spam.
- "Repeatedly posting duplicated and unsolicited replies to many accounts is considered spam behavior."
- Accounts may be excluded from search for "posting lots of duplicate links."

From the [Automation Rules](https://help.x.com/en/rules-and-policies/x-automation) and [Developer Guidelines](https://docs.x.com/developer-guidelines) **[DOC]**:
- "You may not like posts or hide replies in an automated manner." Auto-liking by keyword, hashtag, user or schedule is prohibited; apps may not offer "auto-like" features.
- "You may not follow or unfollow X accounts in a bulk, aggressive, or indiscriminate manner." Automated follow-backs are prohibited.
- Reposting: permitted for informational/entertainment purposes, "no bulk spam."
- Replies: only after a user has engaged first; max one reply per interaction.
- DMs: only after the user DMs you first. **Unsolicited DMs, including automated welcome messages to new followers, are prohibited.**
- Multiple accounts: each must serve "non-duplicative purposes" with "meaningfully different" content. Regional/language-specific accounts are explicitly permitted. Identical cross-posting violates policy.

**Enforcement ladder [DOC]** ([Platform Manipulation policy](https://help.x.com/en/rules-and-policies/platform-manipulation)): anti-spam challenges (account locked, additional verification demanded) → URL denylisting → reach restriction (excluded from search, trends, timelines) → temporary feature restrictions (posts, DMs, Spaces) → required profile modifications → suspension. "For severe violations, accounts will be permanently suspended at first detection."

**Engineering consequence:** X is the one platform where a large part of the standard warmup playbook is *explicitly named as a violation* — automated likes, automated follows, follow churn, and unsolicited DMs are all called out by name. On X the only warmup actions that are not directly named as violating are: reading the timeline, viewing profiles, searching, and manual-equivalent low-volume posting.

## Documented limits

| Limit | Value | Status |
|---|---|---|
| Original posts/day, free accounts | **50** | **[DOC — reported]**. Changed ~16–18 May 2026 ([Engadget](https://www.engadget.com/2175771/x-free-accounts-limited-to-50-posts-and-200-replies-a-day/), [Business Standard](https://www.business-standard.com/technology/tech-news/x-introduces-posting-limits-for-unverified-users-here-s-what-has-changed-126051800933_1.html), [Android Headlines](https://www.androidheadlines.com/2026/05/x-limits-unverified-free-accounts-daily-posts-replies.html)). Reflected on [help.x.com/en/rules-and-policies/x-limits](https://help.x.com/en/rules-and-policies/x-limits). |
| Replies/day, free accounts | **200** | **[DOC — reported]**, same sources |
| Previous post limit (superseded) | 2,400 updates/day, broken into semi-hourly intervals | **[DOC — historical]** |
| DMs/day | **500** for non-Premium | **[DOC — reported]**, same sources |
| Follows/day | **400** (technical limit); **1,000/day** for X Premium | **[DOC]** ([help.x.com/en/using-x/x-follow-limit](https://help.x.com/en/using-x/x-follow-limit)) |
| Follow ceiling / ratio | Every account can follow up to **5,000**; beyond that the ceiling is "automatically calculated based on your unique ratio of followers to following" | **[DOC]** (same) |
| Email changes | 4 per hour | **[DOC — reported]** |
| API — create post | 100 per 15 min (per user); 10,000 per 24 h (per app) | **[DOC]** ([docs.x.com rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)) |
| API — like | 50 per 15 min; **1,000 per 24 h** (per user) | **[DOC]** (same) |
| API — follow | 50 per 15 min (per user) | **[DOC]** (same) |
| API — repost | 50 per 15 min (per user) | **[DOC]** (same) |
| API — send DM | 15 per 15 min + 1,440 per 24 h (per user) | **[DOC]** (same) |
| Post-ID redistribution | ≤1.5M Post IDs per 30-day period | **[DOC]** ([Developer Guidelines](https://docs.x.com/developer-guidelines)) |

**Sourcing caveat:** `help.x.com` is behind Cloudflare and could not be fetched directly by any automated method during this research (403 on every attempt, including via text-extraction proxies). The X Help numbers above are reconstructed from search-index snippets of the official pages plus corroborating May 2026 press coverage. **Before relying on these in code, open the two help pages in a browser and confirm.** The `docs.x.com` API numbers *were* fetched directly and are solid.

**The API like-limit is the most useful anchor in this whole document.** X itself considers 50 likes / 15 min and 1,000 likes / 24 h to be the boundary of sanctioned automated liking. That is a first-party number from the same company, for the same action, in the same product — even though the Automation Rules separately prohibit automated liking on the consumer surface. Treat it as the absolute ceiling and run far below it.

## Account prerequisites

- **Phone/email verification:** X applies "anti-spam challenges" that lock the account and demand additional verification — typically phone confirmation or CAPTCHA ([Platform Manipulation policy](https://help.x.com/en/rules-and-policies/platform-manipulation)) **[DOC]**. This is a reactive gate, not always a registration gate.
- **"Circumventing account creation technical limits" is itself a named violation** ([same](https://help.x.com/en/rules-and-policies/platform-manipulation)) **[DOC]** — i.e. bulk registration from one environment is a violation independent of what the accounts subsequently do.
- **Multiple accounts are explicitly permitted** where each serves "non-duplicative purposes" with "meaningfully different" content, and regional/language-specific accounts are named as an acceptable pattern ([Developer Guidelines](https://docs.x.com/developer-guidelines)) **[DOC]**. For a multi-avatar operation this is the compliance framing to design toward: genuinely distinct personas, distinct content, no cross-engagement.
- Ban-evasion detection reportedly spans "device fingerprinting, IP addresses, phone numbers, and behavioral patterns" **[WEAK]** — vendor claim, not first-party.

## X warmup schedule — practitioner consensus, undocumented

### Primary — TweetAttacksPro 4-phase (May 2026)

[Source](https://blog.tweetattackspro.com/X-Accounts-Safety/How-to-Warm-Up-New-X-\(Twitter\)-Accounts-in-2026-Without-Getting-Suspended-\(Complete-Beginner-to-Pro-Guide\)/21010). Most concrete X schedule found. **All [PC].**

| Phase | Posts/day | Likes | Follows | Replies | DMs |
|---|---|---|---|---|---|
| **Days 1–3** | **0** | "naturally" | — | — | **0** |
| **Days 4–7** | **1–2** | **10–20 posts** | **5–10 accounts** | a few, authentic | **0** |
| **Days 8–14** | **2–4** | — | — | — | **5–10 max/day** |
| **Day 15+** | ramp | — | — | — | gradual increase |

Profile (photo, bio, banner) completed in **phase 1, days 1–3**. **No links anywhere during early phases — not in posts, not in bio, not in DMs.** Every DM must be unique; templated DMs are the most-cited X suspension trigger.

### The longest ramp in the corpus — SocialNexis 60-day curve (May 2026)

[Source](https://socialnexis.com/guides/twitter-automation-safe-2026). The only source giving a percentage-of-cap curve, which is a cleaner abstraction than absolute numbers. **[PC]**

| Period | Regime |
|---|---|
| **Week 1** | Browse heavily. **5–10 follows/day, 10–15 likes/day, no automation at all.** |
| **Week 2** | **1 manual post/day, 1–3 manual replies/day.** |
| **Weeks 3–4** | Automation begins at **30% of platform caps**; posting still manual. |
| **After day 30** | Automated reposts/replies at **60% of caps**. |
| **After day 60** | Full operation. |

Their steady-state safe table for *warmed* accounts: likes 50–100/day (50/hr) · follows 30–50/day (10–15/hr) · reposts 10–20/day · replies 10–30/day if human-written, *"much lower if AI-generated"* · quote posts 5–10/day · posts 2–10/day. **New accounts (<30 days) run at 20–30% of these.**

### Others

- **[WarmSocials](https://www.warmsocials.com/blog/how-to-warm-up-twitter-account-2026)** (Mar 2026): profile complete **day 0 including the link** — *contradicts every other source and every other platform's practice*; 10–20 follows over the first few days; **20–40 min/day**; 1–3 posts/day; **2–3 weeks minimum** before intensifying outreach.
- **[GeeLark](https://www.geelark.com/blog/how-to-warm-up-x-twitter-accounts-safely/)** (Jul 2026): warmup 1–3 weeks — ~7 days for light use, 2–3 weeks for aggressive marketing. Early days: *"like one or two posts from verified news accounts."*
- **[IPFoxy](https://www.ipfoxy.com/blog/ideas-inspiration/5622)**: stage-based, declines to give daily quotas. Names days 1–7 the "cold start / high-risk phase," days 7–30 "stabilization." Rules: avoid frequent profile changes; no ads or external links during cold start; no mass following.
- **DM ramp** ([OpenTweet](https://opentweet.io/blog/x-dm-limits-2026), Jul 2026): cap ~**10 DMs/day** for the first few days, then ramp. TweetAttacksPro puts steady-state safe at **20–50 DMs/day with variation**.

### X cap figures in circulation — note the conflicts

| Metric | Free | Premium | Source / note |
|---|---|---|---|
| Posts/day (all types) | 2,400 | 2,400 | [tendX](https://www.tendx.app/blog/x-twitter-limits-2026), Mar 2026 — **pre-dates the May 2026 change to 50 original posts** |
| Follows/day | 400 | 1,000 | tendX |
| Follows/day | 400 for everyone | 400 | [businessho](https://businessho.com/twitter-follow-limit/) — **direct conflict with tendX on the Premium figure** |
| Follows/hr before rate limit | ~40–50 | — | tendX and businessho agree |
| **Practitioner-safe follows** | **30–50/day, 10–15/hr**; new accounts **5–10/day** | — | SocialNexis; businessho ("under 100–150/day") |
| DMs/day | ~500 | ~1,000 Premium / ~1,500 Premium+ | tendX; OpenTweet |
| Likes | **no published limit** — behaviour-based restriction only | | tendX, explicit |
| Post reads/day | 1,000 unverified; **500 for new accounts** | 10,000 | tendX, labelled as officially confirmed |
| Unfollows/day | 400 | | businessho |
| Follow-block cooldown | **24 h**, up to **72 h** on repeat | | businessho |

[tendX](https://www.tendx.app/blog/x-twitter-limits-2026) is the only practitioner source that explicitly separates CONFIRMED (from X help/dev docs) from REPORTED (third-party) — **prefer it over other secondary X sources.** Note its 2,400 figure predates the May 2026 free-tier change to 50 original posts / 200 replies, which supersedes it **[DOC — reported]**.

### Hard architectural constraints from X policy, not folklore

- **No follow/unfollow cycling, ever.** SocialNexis: *"We don't recommend automated unfollow at all in 2026, even at small scale… Follow 400 accounts, unfollow 400 the next day, repeat, and you'll get restricted even if you never break the daily cap."* This matches X's named "follow churn" violation **[DOC]**.
- **Replies, reposts and quote posts all count against the same daily post bucket** ([tendX](https://www.tendx.app/blog/x-twitter-limits-2026)) — model them as one budget, not four.
- **New accounts get a 500-post read limit** (vs 1,000 unverified), labelled officially confirmed by tendX. **Your scroll/read automation can hit this during warmup.**
- No two managed accounts liking, replying to, or following the same targets in correlated fashion — a named violation **[DOC]**.
- No identical or near-identical content across accounts **[DOC]**.
- No automated welcome DMs **[DOC]**.
- A **mid-March 2026 anti-spam enforcement wave** tightened link handling, especially in DMs; Telegram and WhatsApp links are reported as the most sensitive ([TweetAttacksPro](https://blog.tweetattackspro.com/Twitter-Hacks/X-\(Twitter\)-Suspension-Wave-2026-Proven-Strategies-to-Avoid-Bans-and-Protect-Your-Accounts/17890), Apr 2026) **[PC]**.
- Verification/monetisation gating reportedly requires an account **>90 days old** with recent activity and a confirmed phone **[WEAK]** — useful as a "don't bother before day 90" rule.

### Profile completion timing

X is **the only platform where practitioners say complete the profile immediately** — day 0–3, photo + bio + banner together (TweetAttacksPro phase 1; WarmSocials day 0). They disagree on the link: WarmSocials says day 0, TweetAttacksPro says no links anywhere in early phases. **Take the conservative reading: profile assets early, link late.** Username-change timing: **not found**.

## Soft ban and recovery

| State | Meaning | Duration | Recovery |
|---|---|---|---|
| Anti-spam challenge / lock | "Accounts locked; users prompted for additional verification" **[DOC]** | Minutes–hours **[PC]** | Complete phone/CAPTCHA verification **from the same profile and IP**. |
| Rate-limit lockout | Temporary, not a ban | *"Several minutes to several hours"* ([OpenTweet](https://opentweet.io/blog/x-dm-limits-2026)) **[PC]** | Wait. |
| Follow block | Follow action blocked | **24 h**, up to **72 h** on repeat ([businessho](https://businessho.com/twitter-follow-limit/)) **[PC]** | Stop following entirely for the window. |
| Reach restriction / "shadowban" | "Posts excluded from search, trends, timelines" **[DOC]** | *"A few days to about two weeks"* once the behaviour stops ([NodeMaven](https://nodemaven.com/blog/twitter-shadow-ban/), Jul 2026) **[PC]**. X publishes no timeline. | Stop spam activity → remove/reduce automation → delete duplicate posts → wait → appeal only if you believe it is wrong. |
| Temporary feature restriction | Posts, DMs, Spaces limited **[DOC]** | Not documented | Wait. |
| Suspension | "Permanently suspended at first detection" for severe violations **[DOC]** | Permanent | Appeal; rarely reversed **[PC]**. |

**Detection [PC]:** search your handle while logged out; test hashtags; check whether replies appear for non-followers. Third-party checkers are *"a strong signal, not proof"* (NodeMaven).

⚠️ **Do not over-diagnose.** NodeMaven's most useful observation: **new X accounts have low trust scores by default**, so normal ranking limits *feel* like shadowbans in the first weeks. Build a baseline before alerting.

Note X's "permanently suspended at first detection" posture for severe violations **[DOC]** makes it the least forgiving of the five.

---

# TikTok

TikTok publishes the most explicit *behavioural* prohibitions and the most detailed enforcement statistics; it publishes essentially no numeric action limits.

## What TikTok actually polices

From the [Community Guidelines — Integrity & Authenticity](https://www.tiktok.com/community-guidelines/en/integrity-authenticity) and the [OpenTermsArchive full-text mirror](https://github.com/OpenTermsArchive/contrib-versions/blob/main/TikTok/Community%20Guidelines.md) — all **[DOC]**:

- **"Using automation to run many accounts or send repetitive content."** This is the single most on-point sentence for a multi-account warmup system on any of the five platforms.
- **"Using bots or scripts to write fake reviews or comments, or to increase likes or shares."**
- "Posting a large amount of irrelevant material."
- "Trading, marketing, or providing access to services that artificially increase engagement, such as: Followers or likes."
- "Creating multiple accounts to deceive others."
- "We strictly prohibit automation tools, scripts, or other tricks designed to bypass our systems. These can result in content removal, account bans, or other enforcement."
- Multiple accounts are permitted in principle: users "can have multiple accounts — for example, for fan content or creative expression — but not to deceive others or break the rules." **[DOC]** But: "If someone seriously breaks the rules or tries to dodge enforcement, we may ban all of their accounts." **[DOC]**
- **Unoriginal content is demoted, not removed:** "Reused or unoriginal content posted without creative edits, such as clips that show someone else's watermark or logo" is marked FYF-ineligible **[DOC]**.

From [TikTok Newsroom — "How TikTok counters deceptive behaviour"](https://newsroom.tiktok.com/en-eu/how-tiktok-counters-deceptive-behaviour) **[DOC]**:
- Prohibited: "use of automation to register or operate accounts in bulk."
- Prohibited: "manipulating engagement signals to amplify the reach of certain content."
- Detection looks for accounts "operated by the same entity, [that] share technical similarities like using the same devices," and accounts "trying to conceal their actual location, or using fake personas."
- TikTok also uses "off-platform activity" and "open-source intelligence."

From [TikTok — Our approach to content moderation](https://www.tiktok.com/transparency/en/content-moderation/) **[DOC]**:
- Account-level moderation is **"Activity-based"** technology that examines **"how accounts are being operated"** to "disrupt deceptive activities like bot accounts, spam, or attempts to artificially inflate engagement through fake likes or follow attempts." **This is the clearest first-party statement by any of the five platforms that behavioural pattern, not content, is what gets warmup accounts caught.**

**Enforcement scale [DOC]:**
- 2024: "prevented over 2 billion spam accounts from being created" ([content moderation](https://www.tiktok.com/transparency/en/content-moderation/)).
- H1 2024: 700M fake accounts prevented; 36B fake likes prevented; 15B fake follow requests prevented ([Newsroom](https://newsroom.tiktok.com/en-eu/how-tiktok-counters-deceptive-behaviour)).
- Q3 2025: 118,618,399 fake accounts removed; ~12.62B fake likes and ~3B fake followers removed; 204,534,932 videos removed globally ([Community Guidelines Enforcement Report](https://www.tiktok.com/safety/en/transparency/cg-report)).
- 2024: "over 96% of the content removed through automated technology … was taken down before it had any views"; "over 98% was taken down within 24 hours."

## Documented limits

| Limit | Value | Status |
|---|---|---|
| Minimum account age | **13** ("You must be at least 13 years old to have a TikTok account") | **[DOC]** ([Accounts & Features](https://www.tiktok.com/community-guidelines/en/accounts-features)) |
| DMs | **16+** ("You must be 16 and older to use DMs") | **[DOC]** (same) |
| LIVE + gifting | **18+** ("You must be 18 and older to go LIVE and to send gifts") | **[DOC]** (same) |
| Monetization features | **18+** | **[DOC]** (same) |
| LIVE follower threshold | **1,000 followers**, "may vary across regions" | **[DOC — TikTok support/product surface]**; widely corroborated. Treat the 1,000 figure as reliable and the regional variance as real. |
| Strike expiry | **90 days** — "Strikes on your TikTok account will expire after 90 days" | **[DOC]** ([Newsroom](https://newsroom.tiktok.com/en-us/supporting-creators-with-an-updated-account-enforcement-system), [support](https://support.tiktok.com/en/safety-hc/account-and-user-safety/content-violations-and-bans)) |
| Strike thresholds | Per-feature (Comments, LIVE) and per-policy; "thresholds can vary depending on a violation's potential to cause harm … a stricter threshold for … hateful ideologies than for sharing low-harm spam." **No numeric threshold is published.** | **[DOC]** ([Newsroom](https://newsroom.tiktok.com/en-us/supporting-creators-with-an-updated-account-enforcement-system)) |
| Temporary action suspension | **24–48 hours** — TikTok "will suspend your ability to complete specific actions (upload a video, comment, send direct messages (DM), edit your profile, or start a LIVE)" | **[DOC]** ([Community Guidelines, OpenTermsArchive mirror](https://github.com/OpenTermsArchive/contrib-versions/blob/main/TikTok/Community%20Guidelines.md)) |
| Public-interest account posting restriction | 7–30 days "depending on the severity of the violation" | **[DOC]** ([support](https://support.tiktok.com/en/safety-hc/account-and-user-safety/content-violations-and-bans)) |
| Likes / follows / comments / views per hour or day | **Not published.** | — |

**The 24–48 hour figure is the only documented per-action cooldown number found for any of the five platforms.** It is also the exact list of actions a warmup system drives, which makes it a useful canary: if upload, comment, DM, profile-edit or LIVE all fail simultaneously, that is a documented temporary ban, not a rate limit.

## Account prerequisites

- **Age 13+, DMs 16+, LIVE and monetization 18+** **[DOC]** — the age you declare at signup permanently gates which warmup actions are even available. A profile declared as 16 cannot be warmed toward LIVE.
- Ban evasion is explicitly enumerated as a permanent-ban trigger: "circumventing bans on alternate accounts" and "accounts existing solely to violate our rules" ([support](https://support.tiktok.com/en/safety-hc/account-and-user-safety/content-violations-and-bans)) **[DOC]**.
- **Surface matters more on TikTok than anywhere else.** TikTok explicitly frames its detection around devices ("share technical similarities like using the same devices") **[DOC]**. Practitioner consensus is that TikTok is the harshest of the five toward desktop-web automation and toward non-mobile IPs, and that meaningful warmup and upload should happen on a mobile surface **[PC]**. Desktop web historically cannot go LIVE, has restricted DM functionality, and lacks the effects/sounds surface that drives watch-signal warmup **[PC]**.

## TikTok warmup schedule — practitioner consensus, undocumented

### Recommended primary — cpa.live operator's guide, 14 days (Jun 2026)

[Source](https://cpa.live/en/articles-en/how-to-farm-tiktok-accounts-from-scratch-a-year-operators-guide/). **Best-specified TikTok schedule found** — the only one giving session counts *and* durations *and* cohort survival KPIs. **All [PC].**

| Day | Phase | Actions | Duration |
|---|---|---|---|
| **0** | Setup | Register, open app, close. **No avatar, no bio, no link — leave the profile completely empty.** | 2–3 min |
| **1** | Consumption | FYP only. Full watch-throughs on niche content. **Zero likes.** | 20–25 min |
| **2–3** | Consumption | **2–4 likes/day** on niche content | 25–30 min |
| **4–5** | Engagement | **8–12 likes, 3–5 follows.** **Add avatar** (still no bio link) | 20–30 min, **2 sessions** |
| **6–7** | Engagement | **10–15 likes, 5–8 follows, 3–5 real comments.** **Add bio text** | 30 min |
| **7–10** | First post | Original/edited video, **max 1/day** | +20 min scrolling |
| **11–14** | Scaling | 1 post/day, normal engagement. **Test bio link day 12** | 30–40 min |

Also from this source: **average watch time 8–15 s per video**; **Tier-1 geos (US/UK/CA/AU) need 10–14 days, Tier-2/3 need 5–7**; and *"don't open the app at 9:00 PM every single day."*

### The better gating rule — gate on output, not elapsed days

[Post Bridge](https://support.post-bridge.com/troubleshooting/how-and-why-to-warm-up-a-new-tiktok-account-before-using-post-bridge) defines "warmed up" by an **observable output metric rather than an input count**: 3–7 days of 15 min/day niche scrolling with likes only, then **1 post/day manually from the phone for at least a week**, and the account is considered warm when it **averages 500+ views/post** (their stricter guidance: 500–1,000+ across 5 consecutive videos; their troubleshooting section uses 800+). **[PC]**

**This is the single best design idea in the practitioner corpus** and generalises to the other four platforms: gate the transition from warmup to production on a measured distribution signal, not on a calendar. [ssemble](https://www.ssemble.com/blog/account-warmup-guide-2026) gives the matching pass/fail test: healthy new accounts get **50 to a few hundred views within 24 h** on their first clips; flagged accounts get **0–5 views on the first 3+ clips**.

### Alternative schedules

- **[360uniquizer](https://360uniquizer.com/en/news/tiktok-account-warmup-2026)** (14 d): day 1 = 20–30 min FYP, **zero** likes/follows/comments; day 2 = 15–20 likes, 0 follows; days 3–4 = 30 likes, 5–10 follows, 1–2 comments; **days 5–6 first neutral video**; days 8–10 = 2–3 videos/day; bio link at 1,000 followers or day 10–12; content mix **70% neutral / 30% targeted**.
- **[Nelson Creed](https://nelsoncreed.medium.com/tiktok-farm-on-real-ios-devices-complete-guide-5f712872b5b2)** (real iOS devices, Jun 2026): day 1 = 40–60 min passive scrolling, no engagement; day 2 = keyword searches 40–60 min, like ~10% of viewed content; **day 3+ gate on a feed check** — verify ads appear *and* niche content dominates the FYP before posting. Follow rate **10–15% of viewing volume**. **Zero cross-account interaction inside the farm.**
- **[Multilogin](https://multilogin.com/blog/how-to-warm-up-accounts/)**: days 1–5 watch 30–60 min/day, 20–30 likes/day, 10–15 follows/day; days 6–10 one video every 2 days; days 11–14 one video daily.
- **[GeeLark](https://www.geelark.com/blog/how-to-warm-up-your-tiktok-accounts/)** (Jul 2026): 30–60 min/day **split into shorter sessions**; days 2–7 follow ~5–6/day; 1 video/day weeks 2–3; **evaluate after 12 posts**; stabilisation at week 4–5.
- **[Octo Browser](https://blog.octobrowser.net/tiktok-shadowbans-how-to-get-out)** (Jul 2026): most conservative — wait **48–72 h before the first video**, only **10–20 follows/day**, **1–3 posts/day with 3–4 h minimum between posts**.

**BHW spread (named users, Aug 2025 + Jan 2026 threads):** "2 to 14 days" · "about seven days" (×2) · "at least 7 days" · "10–15 days" · "7–14 days" · "1 week". **Modal answer is 7 days; range 2–15.** One dissenter calls the 24-hour-warmup requirement *"one of the funniest myths spread across BHW."*

**Aged/purchased accounts need roughly half the warmup of fresh registrations** — 5–7 days vs 10–14. Independently stated by cpa.live, 360uniquizer, and AdsPower. **[PC]**

### TikTok cap figures in circulation

| Metric | New (<30 d) | Established | Source |
|---|---|---|---|
| Follows/day | 50–100 | up to 200 | [Conbersa](https://www.conbersa.ai/learn/platform-rate-limit-safety-thresholds) |
| Follows/day | **10–20** | — | [Octo Browser](https://blog.octobrowser.net/tiktok-shadowbans-how-to-get-out) — 5× more conservative |
| Likes/day | 100–200 | 500 | Conbersa; [TokList](https://www.toklist.net/tiktok-daily-action-limits/) agrees on 500 |
| Comments/day | 10–20 | ~200 | Conbersa |
| Posts/day | 3–5 | 5–10 | Conbersa |
| Posts/day "safe" | — | **1–3**, min 3–4 h apart | Octo Browser |
| Posts/day risk bands | — | safe 3–5 · **risky 6–10 · flagged 10+** | [Multilogin](https://multilogin.com/blog/tiktok-shadow-ban/) |
| Automation runtime | — | max **8 h/day** | TokList |
| Hashtags | **3–5** relevant, not 30 | | Multilogin |
| DMs/day, Story views, search queries | **not found** | | |

Conbersa adds that accounts **under two weeks old hit the block ceiling at roughly 30–40% of the established-account numbers**, and that hourly bursts trigger a 24-hour block plus **5–14 days of FYP suppression**. **[PC]**

### Cohort health KPIs worth instrumenting

From [cpa.live](https://cpa.live/en/articles-en/how-to-farm-tiktok-accounts-from-scratch-a-year-operators-guide/) — unusually concrete, and directly usable as monitoring thresholds **[PC]**:
- Day-1 registration survival **>80%**
- 7-day warmup survival **>70%**
- Average views/post over 30 days **>200**
- Follow-back rate during warmup **8–15%**
- Ban rate by week 4 **<25%**
- Practical operator ceiling: **20–30 active accounts solo**, 80–100 with one VA, 300+ needs cloud phones and written SOPs

[Nelson Creed](https://nelsoncreed.medium.com/tiktok-farm-on-real-ios-devices-complete-guide-5f712872b5b2) reports parallel figures: **80–85% survival with real-device warming vs 10–15% on emulators**, 5–6 accounts per device, and one incident of **8 accounts cascade-banned off a single device**.

### TikTok-specific emphases [PC]

- **Watch-to-completion is the highest-value warmup action** and the one most differentiated from the other four platforms. cpa.live's 8–15 s average watch time is the only quantified target found.
- **Consumption:production stays heavily consumption-weighted throughout.** Nelson Creed's ratios: like ~10% of watched content, follow at 10–15% of viewing volume. Conbersa: like **8–12% of watched content** — *"liking everything reads as automated."*
- **Zero cross-account engagement inside the fleet.** Named explicitly by Nelson Creed.
- **Content-hash detection has improved**: simple horizontal flips no longer defeat duplicate detection (Nelson Creed) — relevant if you reuse assets across avatars, which is separately a documented violation **[DOC]**.
- **Geo-consistency triad**: device + IP + SIM + registration region must all agree (cpa.live, 360uniquizer). A US-registered account on a non-US IP is treated as an immediate flag.
- AdsPower's TikTok Cookie Robot is **Chrome-only, Firefox unsupported** ([AdsPower](https://www.adspower.com/blog/cookie-robot-for-tiktok)) — relevant given a Chrome-profile architecture.

### ⚠️ The finding that most threatens a desktop-Chrome TikTok design

Nelson Creed reports **"mobile app showed 10x higher reach"** versus browser/API upload, alongside the 80–85% vs 10–15% survival gap above **[WEAK — single source, self-interested, no methodology]**. GeeLark corroborates the direction without numbers (*"automation on cloud phones is far safer than desktop browsers"*). But BHW user *theusualkeysersoze* (Jan 2026) argues the **opposite** on emulators specifically: *"Mobile anti-detect emulator is also not a good idea… A Windows machine impersonation is likely the best."*

**This is genuinely contested. Plan for desktop-Chrome TikTok to underperform, treat TikTok as the platform most likely to require a mobile path, and measure reach per surface before committing.**

## Soft ban and recovery

| State | Meaning | Duration | Recovery |
|---|---|---|---|
| Temporary action suspension | Upload / comment / DM / profile-edit / LIVE suspended | **24–48 hours** **[DOC]** | Wait. Do not retry the blocked action. |
| Feature restriction pending review | "We may temporarily restrict access to the feature … while your content is under review" **[DOC]** | Until review completes | Wait. |
| FYF ineligibility ("shadowban") | Content "ineligible for recommendation in the For You feed" **[DOC]**. Also applied to unoriginal content **[DOC]**. | Not documented | Stop reposting/unoriginal content; post original edits. Check in-app Account status **[DOC]**. |
| Strike | Accrues per violation, expires after 90 days **[DOC]** | 90 days on record | Appeal in-app; "If approved: content or account will be reinstated and the strike will be removed" **[DOC]** |
| Permanent ban | Repeated violations, single severe violation, enforcement evasion, or dedicated rule-breaking accounts **[DOC]** | Permanent | In-app appeal via Safety Center **[DOC]** |

---

# Cross-platform: proxy, fingerprint, and session requirements

This is the part of the problem with the best technical evidence and the worst folklore-to-fact ratio. Several widely-held beliefs in this area turn out to be **backwards**. Those are flagged ⚠️.

## The single most important architectural fact: device and IP are graph nodes, not attributes

Meta's Deep Entity Classification paper ([USENIX Security '21](https://www.usenix.org/conference/usenixsecurity21/presentation/xu-teng), [PDF](https://faculty.cc.gatech.edu/~pearce/papers/dec_usenix_2021.pdf)) publishes the actual entity table. **Device and IP Address are first-class node types with their own features and their own neighbourhoods [DOC]:**

| Entity type | Direct features | Deep entities (its neighbours) |
|---|---|---|
| User | age, gender | entities administered, posts |
| Group | member count, age | admins, group members |
| **Device** | **operating system** | **users sharing the device** |
| **IP Address** | **country, reputation** | **registered accounts** |
| Photo | like count, hash value | users in the photo |
| Status update | like count, age | groups it shared to |

And, verbatim from the paper:

> *"When classifying fake accounts, deep features include the features from the IP address that registers the account, as well as all the other accounts created from the IP address. When classifying using the above features, **the scripted activity of batch account registration can be easily detected.**"*

> *"a feature can be the number of accounts that logged in from the same device as the target account, given the device uses the Android operating system."*

Scale and performance, also verbatim from the paper: **>20,000 features per entity extracted across two hops**; AUC **0.981**; deployed >2 years; *"responsible for the identification and deactivation of hundreds of millions of accounts"*; abusive-account prevalence cut **5.2% → 3.8%**; total cost **0.7% of Facebook's global CPU**.

The paper also directly addresses the evasion strategy a multi-account operator would reach for:

> *"An attacker may attempt to evade the classifier by creating large groups of fake accounts connected to each other so that they can control all of the deep features. This subgraph would have to either be isolated from the rest of the friend graph (which is itself suspicious) or have a reasonable number of connections to the main graph. In the latter case, since DEC operates on second-order connections, almost all of the DEC features would include data from real accounts outside the adversary's control. In addition, while the adversary controls the fake accounts' behavior, **they don't know how a similar set of connected legitimate users behaves**, and the coordinated activity of the fake accounts would be detected as anomalous."*

**Engineering reading:** you cannot win this by making each account look good in isolation. Direct-feature spoofing (user agent, country, profile completeness, follower count) is explicitly the thing DEC was built to be robust against. What is actually under your control is (a) not sharing device/IP nodes between accounts, and (b) not producing correlated behaviour across accounts.

Supporting first-party evidence from the other platforms:
- **TikTok** looks for accounts "operated by the same entity, [that] share technical similarities like using the same devices," and for accounts "trying to conceal their actual location, or using fake personas" ([TikTok Newsroom](https://newsroom.tiktok.com/en-eu/how-tiktok-counters-deceptive-behaviour)) **[DOC]**. **Location concealment is itself named as a signal** — a proxy whose geolocation contradicts the account's declared locale is worse than no proxy.
- **Meta's Q1 2025 Adversarial Threat Report** ([Transparency Center](https://transparency.meta.com/sr/Q1-2025-Adversarial-threat-report/)) classifies proxy use as an *Evading Detection → Obfuscating infrastructure* tactic in its Online Operations Kill Chain, describing one removed network as showing *"consistent operational security (OpSec) aimed to conceal its origin and coordination, **including by relying on proxy IP infrastructure**"* **[DOC]**. Note the outcome: the proxy infrastructure did not prevent takedown. The same report states Meta focuses *"on behavior, not content."*
- **Instagram-era lineage:** SynchroTrap (Facebook, [ACM CCS 2014](https://users.cs.duke.edu/~xwy/publications/SynchroTrap-ccs14.pdf)) clusters accounts by **loosely synchronised actions** and was deployed on Facebook *and Instagram*, detecting >2M malicious accounts in a single month at >99% precision **[DOC]**.

## Proxy requirements — what the evidence actually supports

### ⚠️ Three corrections to widely-held beliefs

**⚠️ Correction 1 — "Platforms ban datacenter IPs" is not first-party documented.** No Meta, Instagram, Threads, TikTok, or X documentation states that datacenter IPs are blocked, throttled, or penalised for normal account use. Every such claim traces to proxy-vendor marketing or SEO blogs. It is *consistent* with how the commercial anti-bot industry works, and datacenter ranges are trivially classified (MaxMind, IPQualityScore, IP2Proxy all ship the enum) — but **the specific claim is unverified.** Treat "use residential" as a prudent default, not an established fact.

**⚠️ Correction 2 — mobile/CGNAT IPs are not a safety blanket; the data points the other way.** Cloudflare's CGNAT detection research ([Oct 2025](https://blog.cloudflare.com/detecting-cgn-to-reduce-collateral-damage/)) **[DOC]** measured that **CGNAT IPs show *lower* bot rates (7% vs 13.1%) yet are "subject to rate limiting three times more often than non-CGNAT IPs."** The folk logic — "thousands of real users share this IP so the platform can't punish it" — has the consequence exactly inverted: shared IPs get rate-limited *more*, and platforms compensate for the ambiguity by **shifting weight onto device and behavioural signals**, which is strictly worse for a multi-account operator. No primary source verifies any subscribers-per-IP ratio for mobile CGNAT, and **no evidence was found that any platform softens treatment of mobile carrier ASNs.**

**⚠️ Correction 3 — spoofing can make you more identifiable, not less.** Vastel et al., *Fp-Scanner* ([USENIX Security 2018](https://www.usenix.org/system/files/conference/usenixsecurity18/sec18-vastel.pdf)) **[DOC]**: **browsers running UA/fingerprint spoofers become more distinguishable than browsers that don't spoof**, because inconsistency is itself high-entropy. This is the single most important result for anyone building a fingerprint layer.

### How IP classification actually works

Classification is driven substantially by **WHOIS registration strings**, not by traffic analysis. MaxMind's own [Anonymous IP DB docs](https://dev.maxmind.com/geoip/docs/databases/anonymous-ip/) state verbatim: *"If a VPN provider does not register subnets under names associated with them, we will likely only flag their IP ranges using the `is_hosting_provider` flag."* **[DOC]** That is the actual mechanism behind "ISP/static-residential" proxies working — though note the netblock-leasing explanation itself is **vendor-asserted only [WEAK]**; no RIR, RFC or academic source confirms it.

The enums you are actually being scored against:
- **MaxMind**: `is_residential_proxy`, `is_hosting_provider`; connection types `Cable/DSL | Cellular | Corporate | Satellite | Dialup`. minFraud risk reasons include **`MINFRAUD_NETWORK_ACTIVITY`** (*"Suspicious activity has been seen on this IP address **across minFraud customers**"*) and **`EMAIL_VELOCITY`** (*"Many different email addresses have been seen on this IP address"*), plus a `user_count` trait ([docs](https://dev.maxmind.com/minfraud/api-documentation/responses/)) **[DOC]**. **Cross-account co-occurrence on one IP is an explicitly productised, cross-customer signal.**
- **IPQualityScore**: `connection_type` ∈ Residential / Corporate / Education / Mobile / Data Center; plus `shared_connection`, `dynamic_connection`, `recent_abuse`, `frequent_abuser` (6+ months history), `abuse_velocity`. Documented `fraud_score` thresholds: **≥75 suspicious, ≥85 suspicious activity, ≥90 block** ([docs](https://www.ipqualityscore.com/documentation/proxy-detection-api/response-parameters)) **[DOC]**. Their [best-practices doc](https://www.ipqualityscore.com/documentation/proxy-detection-api/best-practices) tells integrators to pass `user_agent` and `user_language` — **locale-vs-IP cross-referencing is built into the product.**
- **IP2Proxy**: `VPN, TOR, PUB, WEB, DCH, SES, RES, CPN, EPN`, where `RES` is defined as *"proxy connections through residential ISP **with or without consents of peers**."*
- **Spur**: `infrastructure` ∈ DATACENTER/MOBILE/RESIDENTIAL; risks include **`GEO_MISMATCH`**; plus `client.concentration`, `client.count`, `client.spread`, `client.behaviors` ([docs](https://docs.spur.us/context-api)) **[DOC]**.

Also worth knowing: **ASN "type" is a statistical inference, not a registry fact.** Stanford's ASdb ([IMC '21](https://lizizhikevich.github.io/assets/papers/ASDB.pdf)) reports 93% accuracy on 17 categories, 75% on 95 sub-categories **[DOC]**. And residential proxy networks are substantially built on compromised hosts: *Resident Evil* ([IEEE S&P 2019](https://conferences.computer.org/sp/pdfs/sp/2019/ResidentEvilUnderstandingResidentialIPProxyasa.pdf)) found 6M+ residential proxy IPs across 230+ countries, many on **likely-compromised hosts including IoT devices**; [arXiv:2404.10610](https://arxiv.org/abs/2404.10610) (2024) found many nodes *"located in corporate networks and deployed without proper authorization."* **[DOC]** Microsoft's CovertNetwork-1658 analysis reports average residential-proxy node uptime of **~90 days** — your "static" residential IP has a half-life.

### 🔑 The highest-value single configuration detail

**Your proxy vendor's own session scheduler is the most likely cause of a mid-session IP change — not the platform.**

Oxylabs' official docs state: *"By default, a session lasts 10 minutes, or ends after 60 seconds without any requests – whichever comes first"* ([session control](https://developers.oxylabs.io/products/proxies/residential-proxies/session-control)) **[DOC]**. **An idle browser tab on a rotating residential pool can silently change egress IP between page loads after 60 seconds of inactivity** — which is exactly what a warmup session with human-like reading pauses looks like.

**Mitigation:** use a fail-closed session mode (Oxylabs' `sessid_oneip` returns **HTTP 502** on peer loss rather than silently rotating), or use dedicated/static IPs. Decodo exposes `sessionduration` 1–1440 min. **Bright Data publishes no maximum sticky-session duration** — third-party figures for it are uncorroborated **[WEAK]**.

### Does the platform log you out on IP change?

**Unknown, and do not assert otherwise.** OWASP's [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) recommends binding session IDs to IP/UA but immediately notes the control is bypassable and produces false positives in NAT environments; its Cookie Theft guidance describes the correct response to *"a significant change in the IP address"* as **step-up re-authentication and cookie reissue**, not hard logout. **No evidence was found that any major social platform cryptographically binds session cookies to IP or ASN.** The practical risk of IP change is a checkpoint, not a logout — but that is inference.

### Rate limiting: what is IP-scoped and what is not

**All *documented* platform rate limiting is credential-scoped, not IP-scoped:** X's limits are per-app and per-user only ([docs.x.com](https://docs.x.com/x-api/fundamentals/rate-limits)); TikTok's are per-endpoint (600 req/min, 1-min sliding window, HTTP 429); Meta's are per app / user / Page / business asset via `X-App-Usage` and `X-Business-Use-Case-Usage`. **IP is never mentioned in any of the three [DOC].**

Where IP *is* a rate-limit key, it is at the WAF layer — and it is broader than IP. Cloudflare's [rate-limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/) document counting characteristics including IP, "IP with NAT support," header/cookie/query values, host, path, **AS Number, JA3 fingerprint, and JA4 fingerprint** **[DOC]**. Two consequences: **(1) ASN is a first-class rate-limit key, so proxy diversity within one ASN buys less than you think; (2) JA3/JA4 are first-class keys, so IP rotation alone does not defeat limiting.** On IPv6: Cloudflare IP Lists support /4–/64 only, because *"the lower 64 bits can often be changed by the end user"* — **/64 is the atomic unit; buying many IPv6 addresses inside one /64 buys nothing.**

### Practical proxy guidance

| Type | Suitability | Basis |
|---|---|---|
| Datacenter | Avoid | Trivially classified by every commercial IP-intelligence vendor. Platform-specific harshness is **[WEAK]**. |
| ISP / static residential | Good | WHOIS resolves to a consumer ISP; mechanism is vendor-asserted **[WEAK]** but consistent with MaxMind's documented behaviour. |
| Residential (sticky) | Good default | Best availability/cost; but note node churn (~90-day average uptime) and the ethics/legality problem of compromised-host networks. |
| Mobile (4G/5G) | Situational, **not a safety blanket** | See Correction 2. Congruent with TikTok's mobile-first architecture, but CGNAT is rate-limited 3× more often. |

**Non-negotiables regardless of type:**
1. One profile ↔ one IP, for the account's whole life.
2. Never share an IP between two managed accounts (`MINFRAUD_NETWORK_ACTIVITY`, `user_count`, Spur `client.count` all price this in).
3. Never answer a checkpoint from a different IP than the account normally uses.
4. **Match timezone and locale to the IP's *country*, not its city.** MaxMind's [own accuracy page](https://www.maxmind.com/en/geoip-accuracy-comparison) reports **61% within 50 km for the United States**, with 31% located to a city but outside 50 km. City-level matching is neither reliably enforceable nor reliably measurable. ⚠️ A widely-circulated "86% US city within 50 km" figure could not be verified on MaxMind's own page and conflicts with the 61% figure — **do not cite it.**

## Fingerprinting: what is actually read, measured rather than asserted

### The best available measurement

Gundelach, Mühlhauser & Herrmann, *"Detecting Bot Detection"* ([arXiv, Jun 2026](https://arxiv.org/html/2606.14525v1)) instrumented 132 JS properties across the Tranco Top 10K **[DOC]**:
- **`navigator.webdriver` is probed on 2,730 of 7,944 sites (34%)** — the single most common check by a wide margin.
- **46% of sites probe at least one Tier-1 signal** (signals with no legitimate non-detection use). Framework coverage: WebDriver API 43%, PhantomJS 32%, NightmareJS 31%, WebDriver Protocol 29%, Selenium 28%, **Chrome DevTools 21%**, ChromeDriver 8%.
- **Cloudflare's scripts probe an average of 13 honeypots and cover all eight fingerprinting categories: Canvas, Audio, WebGL, Speech, Fonts, Dimensions, Permissions, Plugins.** Cloudflare Turnstile is the **6th most-deployed third-party script** on the Tranco Top 10K.
- **Soft-block rates by configuration: Chromium headless 15.2%, Chromium headed 7.2%, Firefox headless 6.8%, Firefox headed 6.8%.** Critically: **75% of Chromium-headless-only blocks are caused by header spoofing alone** (`HeadlessChrome` in the UA, `sec-ch-ua` revealing headless).

**⚠️ And crawl-based measurement systematically undercounts what you will face.** Annamalai, Bilogrevic & De Cristofaro ([WWW 2025](https://arxiv.org/abs/2502.01608)) ran 30 real users over 10 weeks across 3,000 sites and found **automated crawls miss 45% of the fingerprinting sites real users encounter** — because of login walls, anti-bot blocking, and interaction-triggered scripts. **Authenticated social platforms are precisely the case where fingerprinting is heaviest and least studied.**

### Entropy ranking — which surfaces actually matter

From Lawall, *"Fingerprinting and Tracing Shadows"* ([arXiv, Nov 2024](https://arxiv.org/html/2411.12045v1)) **[DOC]**:

| Surface | Uniqueness | Stability |
|---|---|---|
| **WebGL** (`UNMASKED_VENDOR/RENDERER_WEBGL`) | **very high** | **very high** — strongest single signal |
| **WebRTC** | very high | — (no permission prompt, no user notification) |
| Canvas | high | moderate |
| Fonts | high | high |
| Audio | moderate | high |
| Screen | moderate | high |
| HTTP headers | low | — |

⚠️ That paper's "97% uniqueness from WebRTC alone" comes from an **80-device study** — small N, do not over-weight.

For a concrete, verifiable signal list, [FingerprintJS `src/sources/`](https://github.com/fingerprintjs/fingerprintjs/tree/master/src/sources) is production source code: `apple_pay, architecture, audio, audio_base_latency, canvas, color_depth, color_gamut, contrast, cookies_enabled, cpu_class, date_time_locale, device_memory, dom_blockers, font_preferences, fonts, forced_colors, hardware_concurrency, hdr, indexed_db, inverted_colors, languages, local_storage, math, monochrome, open_database, os_cpu, pdf_viewer_enabled, platform, plugins, reduced_motion, screen_frame, screen_resolution, session_storage, timezone, touch_support, user_agent_data, vendor, webgl`.

### Coherence is the actual test — with named check pairs

> *"A classic example: attackers spoof the userAgent string to look like Chrome on Windows, but forget to update `navigator.platform`, which might still say `MacIntel`. That inconsistency is a red flag."*
> — Antoine Vastel, Castle, [Oct 2025](https://blog.castle.io/roll-your-own-bot-detection-fingerprinting-javascript-part-1/) **[DOC]**

Validated pairs a detector will check: **UA ↔ `navigator.platform` · UA ↔ WebGL renderer · UA ↔ `maxTouchPoints` · canvas rendering ↔ claimed platform · Web Worker context values ↔ main-thread values · timezone/locale ↔ IP country.** Castle's [fingerprint-harvesting research](https://castle.io/research/fingerprint-harvesting-in-the-bot-ecosystem/) (811 bot/fraud-adjacent sites analysed) confirms vendors do multi-context collection — main page, iframes, *and* Web Workers — specifically to run cross-context consistency checks.

**WebGL renderer is the cheapest and most damning inconsistency.** Castle, [Feb 2025](https://blog.castle.io/the-role-of-webgl-renderer-in-browser-fingerprinting/): *"a user who claims to be on an Android device in its user agent but who has a WebGL renderer equal to `Apple GPU`, which indicates the presence of MacOS."* **Chrome device emulation does not touch `UNMASKED_RENDERER_WEBGL` at all.** Naive spoofing fails differently: a hardcoded ANGLE string reused across profiles creates a detectable cluster.

**Canvas catches OS spoofing by design.** Picasso canvas fingerprinting (Bursztein, Google) *"can be used to detect desktop devices pretending to be iPhones, or to distinguish between real Android devices and Android emulators"* ([writeup](https://antoinevastel.com/browser%20fingerprinting/2019/03/21/picasso-canvas-fingerprinting.html)) **[DOC]**.

**Timezone↔IP mismatch is a productised signal with a documented trigger.** Fingerprint's `timezone_mismatch` Smart Signal fires when *"the geolocated IP address of the device does not match the `originTimezone` from the system settings"* **or when ≥50% of requests from the same IP over the last 7 days show such a mismatch** ([docs](https://docs.fingerprint.com/docs/smart-signals-reference)) **[DOC]**. The same reference documents **`os_mismatch`**: *"the network signature of the request we receive does not match the signature of the OS of the client"* — i.e. **TCP/IP-stack fingerprinting versus claimed OS**, which no JS-level spoofing touches.

**Client Hints:** sent by default (low-entropy): `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform`. Require `Accept-CH` or `navigator.userAgentData.getHighEntropyValues()`: `-Arch`, `-Bitness`, `-Model`, `-Platform-Version`, `-Full-Version-List`, `-WoW64`, `-Form-Factors` ([spec](https://wicg.github.io/ua-client-hints/), [Chrome docs](https://developer.chrome.com/docs/privacy-security/user-agent-client-hints)) **[DOC]**. **A raw `--user-agent` flag or an extension-level UA swap does not update `navigator.userAgentData` or the CH headers. That desync is the canonical detection.**

### 🔑 WebRTC — the highest-severity single misconfiguration

WebRTC STUN traffic goes out over UDP, **outside the HTTP stack**. An HTTP or SOCKS proxy set via `--proxy-server` or `chrome.proxy` **does not carry it**, so the real egress IP leaks past the proxy entirely.

Chrome's `WebRtcIPHandling` policy ([official docs](https://chromeenterprise.google/policies/web-rtc-ip-handling/)) **[DOC]** has four modes: `default` (all interfaces), `default_public_interface_only`, `default_public_and_private_interfaces`, and **`disable_non_proxied_udp`**. **Only `disable_non_proxied_udp` forces WebRTC through the proxy or falls back to TCP.** For a per-profile-proxy manager this is a one-line setting that determines whether the whole proxy layer works.

## Automation detection — this section has a 2025→2026 inflection, re-test everything

### The classic CDP signal died in May 2025 and was replaced in March 2026

The well-known `Runtime.enable` detection — defining a getter on `Error.prototype.stack` and calling `console.debug(errorObject)` to see whether the inspector serialises it — **was broken by two V8 commits in May 2025** (`61a90754`, "Avoid error side effects in DevTools", 2025-05-07; `e08e9734`, "Apply getter guard throughout error preview", 2025-05-09), which added `getErrorProperty()` skipping getters with a valid `ScriptId`. Documented by Antoine Vastel, Castle, [Aug 2025](https://blog.castle.io/why-a-classic-cdp-bot-detection-signal-suddenly-stopped-working-and-nobody-noticed/) **[DOC]**.

**Its replacement, unpatched as of March 2026**, is a prototype-chain Proxy trap — the inspector's `DebugPropertyIterator` collects prototype-chain keys before any Proxy guard applies, and per ECMAScript must invoke `ownKeys`:

```javascript
const trap = new Proxy({}, { ownKeys(){ detected = true; return []; } });
console.groupEnd(Object.create(trap));   // fires iff the Runtime domain is enabled
```
— Sveba, [Mar 2026](https://svebaa.github.io/personal/blog/cdp-fingerprinting/) **[DOC]**

**→ Any tooling whose "CDP stealth" was validated in 2024–2025 must be re-tested.**

### Your test matrix

Two open-source detectors enumerate the actual leaks; use them as an acceptance suite:
- **[rebrowser-bot-detector](https://github.com/rebrowser/rebrowser-bot-detector)**: `runtimeEnableLeak` · `sourceUrlLeak` (Puppeteer injects `//# sourceURL=pptr:...`, visible in `Error.stack`) · `mainWorldExecution` · `navigatorWebdriver` · `bypassCsp` (**no real browser disables CSP**) · **`viewport`** (Puppeteer defaults to **800×600**, Playwright to **1280×720** — neither is a real monitor size) · `useragent` ("Google Chrome for Testing") · `pwInitScripts` (`__pwInitScripts` in global scope).
- **[brotector](https://github.com/kaliiiiiiiiii/brotector)**: adds `Input.coordinatesLeak` (Chromium bug 1477537) · **`window.cdc`** (chromedriver) · `Event.isTrusted` · **`canvasMouseVisualizer`** (detects `CanvasRenderingContext2D.arc` called within ±5 px of the current mouse position) · `UAOverride` (empty `getHighEntropyValues`) · `popupCrash`. Detects Selenium, Puppeteer, Playwright, Pyppeteer, **Nodriver**, and @ulixee/hero.

Also test against [rebrowser.net/bot-detector](https://rebrowser.net/bot-detector), CreepJS, and [deviceandbrowserinfo.com/are_you_a_bot](https://deviceandbrowserinfo.com/are_you_a_bot).

### 🔑 Your spoofing layer is itself a fingerprint

Castle demonstrated catching the anti-detect browser *Undetectable* injecting canvas/WebGL/hardware spoofing via `Page.evaluateOnNewDocument` — visible as `scriptParsed` events and as "VM" entries in DevTools memory sampling ([Apr 2025](https://blog.castle.io/how-to-detect-scripts-injected-via-cdp-in-chrome-2/)) **[DOC]**. **CDP-injected stealth scripts are detectable as CDP-injected stealth scripts.**

**`puppeteer-extra-plugin-stealth` is effectively abandoned** — v2.11.2, published **March 2023**, no release since; no patches for Sec-CH-UA inconsistencies, JA4, or CDP-injected globals **[DOC]**. Current approaches that address the above: patched drivers (rebrowser-patches, patchright) or patched browsers ([Camoufox](https://camoufox.com/), which spoofs at the **C++ level with no JS injection** and explicitly refuses to spoof Chromium fingerprints from Firefox because the mismatch would be detectable).

### TLS and HTTP/2 — the layer JS cannot fix

JA4 fingerprinting is deployed by Cloudflare, AWS WAF, and Akamai (which exposes it as an [API](https://techdocs.akamai.com/application-security/reference/get-ja4-fingerprint-settings)) **[DOC]**. JA4 sorts TLS extensions before hashing, repairing what Chrome's extension-order randomisation broke in JA3. The current multi-layer academic model (Fayolle et al., [Jun 2026](https://arxiv.org/pdf/2606.30119)) stacks: TLS handshake/JA4 → HTTP/2 frame sequences and request ordering → Client Hints vs UA consistency → WebDriver properties → headless indicators → DOM anomalies → API response timing.

**Two consequences for your design: (1) this is a strong argument for driving a real Chrome rather than an HTTP client, because a real Chrome behind an HTTP CONNECT proxy keeps its own genuine ClientHello; (2) your proxy must not MITM, or it replaces that genuine ClientHello with the proxy's.**

### TikTok specifically is the hardest target, and it is well documented

TikTok has by far the largest public reverse-engineering corpus of the five **[DOC]**:
- `webmssdk.js` uses **VM-based obfuscation** — sensitive JS compiled to custom bytecode with a shipped interpreter ([nullpt.rs](https://nullpt.rs/reverse-engineering-tiktok-vm-1)). The SDK collects screen dimensions, **battery status**, timezone, language, UA, platform, **canvas**, and **WebGL GPU info**.
- The current request signature is **`X-Gnarly`** (webmssdk 5.1.3-ZTCA), whose inputs include **MD5 of the query string, MD5 of the request body, MD5 of the User-Agent**, timestamps, and **a count of intercepted XHR + fetch requests** ([decoded](https://github.com/carcabot/tiktok-xgnarly-decoded)).
- `ttwid`, `msToken` and `s_v_web_id` are **generated at runtime by JS from canvas/WebGL/audio/font enumeration** ([writeup](https://autodev.blog/posts/tiktok-research-article/), Dec 2025).
- Beyond JS, the same research reports **TLS fingerprinting, HTTP/2 frame ordering, and TCP/IP stack behaviour**, with the author observing *"TikTok's edge servers are dropping the request before it even reaches the application layer"* even with correct signatures.

**→ You cannot shortcut TikTok with an HTTP client. `msToken` is server-reissued per request and the device cookies only exist if `webmssdk.js` actually ran against a real canvas/WebGL/audio stack.**

X is similar in spirit: `x-client-transaction-id` is derived from the homepage's `twitter-site-verification` meta tag, indices extracted from the `ondemand.s` JS file, the HTTP verb and path, and **SVG animation frame data from the `loading-x-anim` element** ([XClientTransaction](https://github.com/iSarabjitDhiman/XClientTransaction)) **[DOC]** — request signing bound to the DOM state of a rendered page.

**Honest gap:** **no public reverse-engineering writeup of Meta's web fingerprinting or bot-detection scripts** exists comparable to the TikTok corpus. Treat any specific claim about "what Instagram's JS reads" as unverified.

## Cookie, storage and session persistence

### Meta — the best-documented case

Dimova, Franken et al. (KU Leuven), *"Tracking the Evolution of Cookie-based Tracking on Facebook"* ([WPES 2022](https://lepoch.at/files/facebook-cookie-tracking-wpes22.pdf)) **[DOC]**, measuring 2015/2017/2018/2022:

| Cookie | Meta's own stated purpose (quoted in the paper) | Lifetime |
|---|---|---|
| **`datr`** | *"identifies browsers for purposes of security and site integrity, including for account recovery, and identification of potentially compromised accounts"* | **2 years** |
| **`sb`** | *"identifies browsers for login authentication purposes"* | **2 years** |
| `fr` | *"Facebook's primary advertising cookie"* | 90 days |
| `c_user` | account verification (numeric user ID) | 90 days (2018) → **1 year** (2022) |
| `xs` | session ID | — |

**The operationally critical finding, verbatim:** on logout *"the `c_user` cookie… and the `xs` cookie (a session ID)… are always deleted"* but *"the ones that remain stored in browser are the `datr` and `sb` identifier cookies"* — and *"The `datr` cookie… was not deleted when logging out of Facebook."*

**→ `datr` is a browser identity that outlives login sessions by up to two years, and Meta describes it in explicitly *security and integrity* terms. It is the anchor by which Meta recognises a returning browser. Clearing it makes every session look like a brand-new, zero-history browser.**

⚠️ Meta's current cookie policies ([Facebook](https://www.facebook.com/privacy/policies/cookies/), [Instagram](https://privacycenter.instagram.com/policies/cookies/)) list only *categories* — Authentication; Security, site and product integrity; Advertising; Site features; Performance; Analytics — and no longer name individual cookies. The KU Leuven paper is the best available evidence for the specific names.

⚠️ **Instagram's `mid` and `ig_did` are observable in practice but are NOT documented by Meta.** Aggregator descriptions only — **[WEAK]**.

### TikTok — first-party

From TikTok's own [cookie policy](https://www.tiktok.com/legal/page/global/cookie-policy/en) **[DOC]**:
- **`ttwid`** — listed under **Safety & Security**: *"Prevent fraudulent attacks"* and *"Detect non-human traffic"* — **1 year**.
- **`sid_tt`** — *"remember your login details and status while you browse"* — **2 months**.
- **`msToken`, `tt_csrf_token` and `s_v_web_id` are NOT in the official policy** — they are generated at runtime by `webmssdk.js`.

⚠️ Note a source conflict: cookiedatabase.org classifies `ttwid` as marketing/embedded-content. **TikTok's own policy is authoritative and says fraud prevention and non-human traffic detection.**

### X

`auth_token` = session authentication; **`ct0` = CSRF token that must match the `x-csrf-token` request header**; guest sessions require a separately-obtained `x-guest-token` exposing only a subset of endpoints. Sources are reverse-engineering writeups, not first-party **[DOC — technical, not 1P]**. **No first-party X documentation of `guest_id`'s purpose was found.**

### What follows for your storage layer

The evidentiary chain is direct: `datr` is explicitly for *"security and site integrity, including… identification of potentially compromised accounts"* and survives logout for 2 years; `ttwid` is explicitly for *"prevent fraudulent attacks / detect non-human traffic"* and lives 1 year. **Therefore clearing cookies between sessions destroys precisely the identifiers that make a returning session look like a returning session.**

⚠️ **But the specific downstream behaviour — checkpoint, SMS verification, challenge — is not documented by any platform. Do not assert it as fact; measure it.**

**Rules:**
1. **Persist the entire profile directory** — cookies, localStorage, IndexedDB, Cache Storage — indefinitely, per profile. Treat it as the account's identity, not a cache.
2. **Never share a cookie jar between profiles.** A shared `datr` links them definitively.
3. **Do not reset the profile after an action block.** Resetting is indistinguishable from evasion, which is a documented enforcement trigger on both Meta and TikTok **[DOC]**.
4. **Back up profile storage.** Losing a warmed profile's cookies loses its device trust, not just its login.

### Chrome mechanics a profile manager must get right

- Cookies and storage are **per-Profile**; the Profile directory sits inside the user data dir; `--user-data-dir` overrides the parent ([Chromium docs](https://chromium.googlesource.com/chromium/src/+/master/docs/user_data_dir.md)) **[DOC]**.
- **`--proxy-server` is process-wide**, and a second Chrome launch is routed into the existing process *unless* it is given a distinct `--user-data-dir`. The `chrome.proxy` extension API has modes `direct | auto_detect | pac_script | fixed_servers | system` and **documents no credential fields** — proxy authentication requires `webRequest.onAuthRequired` ([Chrome docs](https://developer.chrome.com/docs/extensions/reference/api/proxy)) **[DOC]**.
- **→ One OS process per profile, each with its own `--user-data-dir` and `--proxy-server`, plus `WebRtcIPHandling=disable_non_proxied_udp`.**
- Chrome 115+ **partitions** third-party localStorage/sessionStorage/IndexedDB by top-level site ([Privacy Sandbox](https://privacysandbox.google.com/cookies/storage-partitioning)) — irrelevant for first-party platform state, relevant if you rely on embeds.

## Mobile-web vs desktop-web vs native app

### What desktop web genuinely cannot do

| Platform | Blocked on desktop web | Evidence |
|---|---|---|
| **Instagram** | **Stories creation; Live broadcast; camera capture; Reels templates; AR effects / audio library / stickers** | Reels templates: [help.instagram.com/610485296790527](https://help.instagram.com/610485296790527/) states the feature *"isn't available on computers"* **[DOC via index]**. ⚠️ **No first-party page explicitly says "no Stories on computer" — that is strong inference, not a citation.** |
| **TikTok** | AR effects/filters, camera record, in-flow sound library. **LIVE Studio is a Windows-only native app** | [LIVE Studio access](https://www.tiktok.com/live/creators/en-US/article/tiktok-live-studio-access_en-US): gaming creators 1,000 followers, **non-gaming 10,000**, Windows only **[DOC via index]** |
| **X** | **Hosting a Space** — the one unambiguous documented wall | [help.x.com/en/using-x/spaces](https://help.x.com/en/using-x/spaces): *"Currently, starting a Space on web is not possible, but anyone can join and listen"* **[DOC via index]** |
| **Threads** | Near-parity since **5 May 2026** | Web DMs launched 2026-05-05 (1:1 + groups to 50, reactions, photos/GIFs, Requests, search) — [TechCrunch](https://techcrunch.com/2026/05/05/threads-finally-brings-messaging-to-the-web/). **~3 months old — expect staged rollout and per-account variance.** |
| **Facebook** | Story **polls** only; otherwise essentially full parity | Meta publishes a page literally titled *"Create Facebook Reels on a Computer"* ([link](https://www.facebook.com/business/help/788798789630803)) **[DOC]** |

**Instagram desktop CAN do:** feed photo/video posts (global rollout Oct 2021), Reels *upload* of a finished file (crop/trim/cover only), and **DMs since ~April 2020**.

⚠️ **Stale-doc trap:** the legacy URL `help.instagram.com/customer/portal/articles/266114-...` still indexes *"You can't take or upload photos from a desktop computer."* That is pre-2021 and false today.

### 🔑 How to build the definitive app-only matrix yourself

Instagram help articles carry a literal machine-readable banner: **"This feature isn't available on computers, but it is available on these devices."** Confirmed present on `help.instagram.com/1133988223332503`, `/1382185835750156/`, `/556617736965724/`, `/1335687273948910/`, `/1974026079559282/`.

**Render `help.instagram.com` with your own headless browser and grep every article for that exact string.** That yields the definitive first-party app-only matrix. No blog has it, and it could not be produced here because the help centre is a JS-rendered SPA. **This is the highest-value follow-up task in this document.**

⚠️ **TikTok's own docs contradict each other on upload limits:** [one FAQ](https://www.tiktok.com/support/faq_detail?id=7581820704895703564) says MP4/WebM, up to 30 minutes, under 10 GB; [Creator Academy](https://www.tiktok.com/creator-academy/article/tool-web-creation-intro) says 60 minutes, up to 4K, **30 GB**, bulk upload of 30 videos (>1k followers), scheduling 30 days out. **Probe empirically; do not hardcode from docs.** TikTok also disclaims LIVE thresholds: *"The requirements vary by country or region and are subject to change without notice."*

### Is mobile-web emulation detectable? Yes — Google says so

[Chrome DevTools device mode docs](https://developer.chrome.com/docs/devtools/device-mode/) **[DOC]**, verbatim:

> *"Think of device mode as a **first-order approximation**…"*
> *"With device mode **you don't actually run your code on a mobile device**."*

Emulated: viewport, CPU/network throttling, and via the Sensors panel geolocation, orientation, touch, idle. **Not emulated: GPU/WebGL renderer, real screen metrics, the UA-CH stack, the TLS/HTTP2 stack, or realistic device motion.**

Concrete tells:
- **`navigator.maxTouchPoints`** — real iOS Safari returns 5; real Android Chrome returns 5 or 10. **Chrome emulation returns 0 or 1**, and `maxTouchPoints` / `'ontouchstart' in document` are documented as returning *inconsistent* values for the same emulated screen.
- **UA ↔ Client Hints desync** — the strongest header-layer tell. Sicuranext, [Dec 2025](https://blog.sicuranext.com/sec-fetch-and-client-hints-a-powerful-tool-against-automation/) **[DOC]**: UA claiming `Linux x86_64` while `Sec-CH-UA-Platform: "Windows"`; UA claiming `Chrome/140` while `Sec-CH-UA` reports `v="100"` (*"real Chrome aligns the UA major version with Sec-CH-UA predictably"*); total absence of CH on Chrome 140+. Also `Sec-Fetch-*` anomalies: `Sec-Fetch-Site: none` on internal navigation, `Sec-Fetch-Dest: document` on XHR, missing `Sec-Fetch-User: ?1`. **Useful counter-caveat from the same source: Android WebView and iOS WKWebView legitimately omit CH and always send `Sec-Fetch-Site: none` — genuine in-app-browser traffic looks bot-like.**
- **WebGL renderer** and **canvas/Picasso** — untouched by emulation (see above).
- **TLS/JA4** — device mode does nothing at the network layer.
- **CSS `pointer`/`hover` vs `any-pointer`/`any-hover`** — emulation flips the primary values; ⚠️ **whether `any-pointer: fine` still evaluates true (revealing an attached mouse) under emulation is UNVERIFIED. It is cheap for a detector to check and cheap for you to measure. Test it.**
- **DeviceMotion** — real handheld devices emit constant accelerometer micro-jitter; an emulator emits nothing or perfectly constant values.

⚠️ **Dismiss this if you find it:** a [2014 Google Groups thread](https://groups.google.com/g/google-chrome-developer-tools/c/bm0U3HcBklA) where a Chrome engineer answers "I don't think so" to whether device emulation is detectable. A decade old and comprehensively false today.

⚠️ **Whether Meta or TikTok specifically run emulation-detection on their mobile-web flows is UNVERIFIED** — no first-party or credible technical source found either way.

### Engineering consequences

- **A desktop-web-only warmer cannot execute the Instagram protocol as practitioners define it**, because Story views and Story posts are core warmup actions on the app surface. Either accept a degraded Instagram warmup or run Instagram on a real mobile surface.
- **TikTok is the worst fit for desktop-web warmup** — missing features, device-centric detection **[DOC]**, `webmssdk` signing bound to a real rendering stack **[DOC]**, and a contested but repeated practitioner claim of ~10× reach difference **[WEAK]**.
- **Do not emulate mobile.** Device mode leaves WebGL renderer, TLS/JA4, `maxTouchPoints`, canvas rasterisation, and motion sensors untouched. Emulating mobile credibly is a full-stack commitment, not a UA string change — and per Fp-Scanner, a *partial* emulation makes you more identifiable than not emulating at all.
- **Facebook, Threads and X warm acceptably on desktop web.** Concentrate mobile/native investment on Instagram and TikTok.

## Behavioural de-correlation — the part fingerprint work cannot fix

The signals that actually caught coordinated networks in peer-reviewed work are behavioural, not technical. Luceri, Salkar, Balasubramanian et al., *"Coordinated Inauthentic Behavior on TikTok"* ([ICWSM 2026](https://arxiv.org/abs/2505.10867)) analysed **793,000 videos** from the 2024 US election **[DOC]**:

- **What detected coordination:** synchronised posting times · repeated similar captions · **multimedia content reuse** · hashtag sequence overlap.
- **What did NOT detect it:** textual similarity of video transcripts · Duet/Stitch interaction signals.

Broader survey ([arXiv:2408.01257](https://arxiv.org/abs/2408.01257)) lists the full signal family: temporal co-timing, co-retweet/network similarity, **shared IPs and devices, identical user-agent strings, browser fingerprinting data**, and content/hashtag/URL similarity.

**Design rules that follow:**
1. **Jitter session start times across the fleet.** Conbersa's staggering example (07:15 / 08:40 / 10:05) is the practitioner form of this **[PC]**; the ICWSM paper is the evidence for why it matters.
2. **Never reuse a media asset across two managed accounts.** Content reuse was a top detector, and cross-account duplication is separately a named policy violation on X and Meta **[DOC]**.
3. **Never reuse caption or hashtag *sequences*.** Sequence overlap detected coordination even where transcript similarity did not.
4. **Never have two managed accounts engage with each other or follow the same seed set in the same order.**
5. **Vary posting cadence per account**, not just per-action delays.

Note that DEC's evasion paragraph makes the same point from Meta's side: *"they don't know how a similar set of connected legitimate users behaves, and the coordinated activity of the fake accounts would be detected as anomalous."* **[DOC]**

---

# Failure modes — what actually gets warmup accounts killed

Ranked by how frequently they are cited across the sources reviewed, and cross-checked against what platforms actually document.

| # | Failure mode | Evidence class |
|---|---|---|
| **1** | **Bad registration environment.** Account is scored and killed at or within minutes of creation, before any warmup runs. Meta blocks "millions of attempts to create fake accounts every day" and detects "millions more, often within minutes after creation" **[DOC]**; DEC removed most abusive accounts "within minutes of registration" **[DOC]**; TikTok prevented >2B spam account creations in 2024 **[DOC]**. | **[DOC]** — strongest-evidenced failure mode of all. |
| **2** | **Account linkage / clustering.** Shared IP, shared device fingerprint, shared cookie jar, shared phone/email, shared payment method, or a correlated follow graph across your own accounts. Meta enforces on "close linkage with a network of accounts" **[DOC]**; DEC's whole design is graph-based **[DOC]**; TikTok looks for accounts sharing "the same devices" **[DOC]**; X prohibits accounts that "engage with the same posts, accounts, or polls" **[DOC]**. | **[DOC]** |
| **3** | **Cross-account content duplication.** Identical or near-identical posts, captions, or replies across managed accounts. Named violation on X **[DOC]**; named as the defining spam-network pattern by Meta ("hundreds of accounts to share the same spammy content") **[DOC]**; TikTok's unoriginal-content demotion **[DOC]**. | **[DOC]** |
| **4** | **Automated engagement at any rate.** Scripted likes and follows are prohibited by name on X **[DOC]**, TikTok **[DOC]**, and Meta **[DOC]** — pacing does not make them compliant, it only makes them harder to detect. | **[DOC]** |
| **5** | **Follow/unfollow churn.** Explicitly named by X as "follow churn … in an effort to inflate one's own follower count" **[DOC]**; cited as a top Threads shadowban trigger **[PC]**. The classic growth loop is a first-class violation. | **[DOC]** for X; **[PC]** elsewhere |
| **6** | **Geo/locale incoherence.** IP country vs declared locale vs timezone vs language vs posting hours. TikTok names "trying to conceal their actual location" as a detection signal **[DOC]**; Meta's DEC uses IP country as a direct feature **[DOC]**. | **[DOC]** basis, **[PC]** specifics |
| **7** | **Behavioural correlation across your own fleet.** Synchronised posting times, reused media assets, and overlapping caption/hashtag *sequences* — the three signals that actually detected coordinated networks in a peer-reviewed 793,000-video TikTok study ([ICWSM 2026](https://arxiv.org/abs/2505.10867)). Orthogonal to fingerprint and proxy hygiene, and not fixable by either. | **[DOC]** |
| **8** | **WebRTC leak past the proxy.** STUN runs over UDP outside the HTTP stack, so `--proxy-server` does not carry it. Only Chrome's `WebRtcIPHandling=disable_non_proxied_udp` prevents it ([Chrome policy docs](https://chromeenterprise.google/policies/web-rtc-ip-handling/)). Severity is total: the real egress IP is exposed and all profile isolation collapses at once. | **[DOC]** for the mechanism |
| **9** | **Silent mid-session IP rotation caused by your own proxy vendor.** Oxylabs' documented default ends a session *"after 60 seconds without any requests"* — an idle tab during a human-paced reading pause changes egress IP. Fail-closed session modes or static IPs prevent it. | **[DOC]** |
| **10** | **Answering a checkpoint from a different IP or profile.** Turns a recoverable verification into a disable. | **[PC]** — very consistently cited. |
| **11** | **Retrying a blocked action.** Reported everywhere to extend block duration. | **[PC]** |
| **12** | **Incoherent fingerprint — and over-spoofing.** UA↔platform, UA↔WebGL renderer, UA↔`maxTouchPoints`, main-thread↔Web Worker, timezone↔IP country. Note the counterintuitive result: **spoofed browsers are more identifiable than un-spoofed ones** ([Fp-Scanner, USENIX 2018](https://www.usenix.org/system/files/conference/usenixsecurity18/sec18-vastel.pdf)) — a partial spoof is worse than none. Your spoofing layer is itself detectable if injected via CDP ([Castle, 2025](https://blog.castle.io/how-to-detect-scripts-injected-via-cdp-in-chrome-2/)). | **[DOC]** |
| **13** | **Detectable automation stack.** `navigator.webdriver` is probed on **34% of the Tranco Top 10K**, and 46% of sites probe at least one automation-only signal ([arXiv 2026](https://arxiv.org/html/2606.14525v1)). Puppeteer's 800×600 and Playwright's 1280×720 default viewports, `bypassCsp`, `__pwInitScripts`, `window.cdc`, and the March-2026 prototype-chain CDP trap are all live tells. `puppeteer-extra-plugin-stealth` has had no release since March 2023. | **[DOC]** |
| **14** | **Too-perfect profile / stock or AI-generated avatar.** X explicitly names "stock, stolen or AI-generated profile photos" as a fake-persona indicator **[DOC]**. Practitioners additionally warn that fully-complete profiles on day 1 look synthetic **[PC]/[WEAK]**. | **[DOC]** for the avatar; **[WEAK]** for profile completeness |
| **15** | **Posting too early / posting commercial content too early.** Vendor sources put the first post between day 1 and week 4 — no consensus — but all put external links later still. | **[PC]** |
| **16** | **Hashtag stuffing.** Now structurally capped at 5 on Instagram **[DOC]** and named by Meta as a spam tactic ("an inordinate amount of hashtags") **[DOC]**; "excessive, unrelated hashtags" named by X **[DOC]**. | **[DOC]** |
| **17** | **Unsolicited DMs.** Prohibited outright on X including automated welcome messages **[DOC]**; DM'ing early is the most-cited Instagram action-block trigger **[PC]**. | **[DOC]** for X |
| **18** | **Clearing cookies / rebuilding the profile between sessions.** Destroys `datr`/`sb` (2-year Meta browser identity, explicitly described as security-and-integrity) and `ttwid` (1-year TikTok fraud-prevention identity), making every session look like a brand-new browser. Also reads as evasion, a documented enforcement trigger **[DOC]**. | **[DOC]** for the cookies; **[PC]** for the consequence |
| **19** | **Robotic timing.** Fixed intervals, identical session lengths, zero-variance daily schedules, 24/7 activity with no sleep window. TikTok's account moderation is explicitly "activity-based," examining "how accounts are being operated" **[DOC]**. | **[DOC]** basis, **[PC]** specifics |
| **20** | **Buying pre-warmed accounts.** Inherits unknown IP/device history and unknown prior enforcement. cpa.live reports bulk $0.10 accounts run **30–60% banned in week 1** with another 20–30% stuck at zero views — an effective $1–3 per working account **[PC]**. | **[PC]** |
| **21** | **Emulating mobile badly.** Chrome device mode is, per Google's own docs, *"a first-order approximation"* that leaves WebGL renderer, TLS/JA4, `maxTouchPoints`, canvas rasterisation and motion sensors untouched. Per #12, a partial emulation is worse than none. | **[DOC]** |

**Two failure modes that are *not* on this list, because the evidence does not support them:**
- **"Datacenter IP" alone.** No first-party platform documentation states datacenter IPs are penalised for normal account use. Prudent to avoid; not evidenced.
- **"Not using mobile proxies."** Cloudflare's measurement shows CGNAT IPs are rate-limited **3× more often** than non-CGNAT despite lower bot rates. Mobile is not a safety blanket.

---

# Confidence and sourcing

## Claims that are platform-documented and safe to build on

- All prohibited-behaviour lists quoted from Meta's [Spam](https://transparency.meta.com/policies/community-standards/spam/), [Inauthentic Behavior](https://transparency.meta.com/policies/community-standards/inauthentic-behavior/) and [Account Integrity](https://transparency.meta.com/policies/community-standards/account-integrity/) policies; X's [Platform Manipulation](https://help.x.com/en/rules-and-policies/platform-manipulation), [Automation Rules](https://help.x.com/en/rules-and-policies/x-automation) and [Developer Guidelines](https://docs.x.com/developer-guidelines); TikTok's [Community Guidelines](https://www.tiktok.com/community-guidelines/en/integrity-authenticity).
- Meta's strike ladder durations (1/3/7/30 days) and 1-year strike expiry — [restricting accounts](https://transparency.meta.com/enforcement/taking-action/restricting-accounts/), [counting strikes](https://transparency.meta.com/enforcement/taking-action/counting-strikes/).
- Instagram's 7,500 following cap — [help.instagram.com/408167069251249](https://help.instagram.com/408167069251249/).
- Instagram Graph API 100 posts/24 h — [content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing).
- Threads API 250 posts / 1,000 replies per 24 h, and the 90-day re-signup cooldown — [Threads overview](https://developers.facebook.com/documentation/threads/overview), [Instagram Help](https://www.facebook.com/help/instagram/313703828012423).
- X API rate limits (50 likes/15 min, 1,000 likes/24 h, 50 follows/15 min, 100 posts/15 min, 15 DMs/15 min) — [docs.x.com](https://docs.x.com/x-api/fundamentals/rate-limits). **Fetched directly; highest confidence numbers in this document.**
- TikTok age gates (13 / 16 DM / 18 LIVE & monetization), 90-day strike expiry, and the 24–48 hour temporary action suspension — [Accounts & Features](https://www.tiktok.com/community-guidelines/en/accounts-features), [Newsroom](https://newsroom.tiktok.com/en-us/supporting-creators-with-an-updated-account-enforcement-system), [support](https://support.tiktok.com/en/safety-hc/account-and-user-safety/content-violations-and-bans).
- Meta's DEC detection architecture, including the verbatim entity table with Device and IP Address as node types — [USENIX Security '21](https://www.usenix.org/conference/usenixsecurity21/presentation/xu-teng), [PDF](https://faculty.cc.gatech.edu/~pearce/papers/dec_usenix_2021.pdf). Peer-reviewed, first-party, and the best available window into how Meta actually classifies accounts.
- TikTok's "activity-based" account moderation description — [content moderation](https://www.tiktok.com/transparency/en/content-moderation/).
- Meta's Q1 2025 Adversarial Threat Report naming proxy infrastructure as an *Evading Detection* tactic — [Transparency Center](https://transparency.meta.com/sr/Q1-2025-Adversarial-threat-report/).
- Meta cookie names, purposes and lifetimes (`datr`/`sb` 2 years, surviving logout) — [KU Leuven, WPES 2022](https://lepoch.at/files/facebook-cookie-tracking-wpes22.pdf). Peer-reviewed, quotes Meta's own stated purposes.
- TikTok cookie purposes and lifetimes (`ttwid` 1 year, fraud prevention / non-human-traffic detection) — [TikTok cookie policy](https://www.tiktok.com/legal/page/global/cookie-policy/en). Fetched directly.
- Chrome's `WebRtcIPHandling` policy modes — [Chrome Enterprise policy docs](https://chromeenterprise.google/policies/web-rtc-ip-handling/). `chrome.proxy` API surface and lack of credential fields — [Chrome extension docs](https://developer.chrome.com/docs/extensions/reference/api/proxy).
- Chrome DevTools device mode being *"a first-order approximation"* where *"you don't actually run your code on a mobile device"* — [Google's own docs](https://developer.chrome.com/docs/devtools/device-mode/).
- Bot-detection prevalence measurements (34% of Tranco Top 10K probe `navigator.webdriver`; 75% of headless-only blocks caused by header spoofing) — [arXiv, Jun 2026](https://arxiv.org/html/2606.14525v1). Peer-reviewed-quality instrumentation study.
- Spoofed browsers being *more* identifiable than un-spoofed — [Fp-Scanner, USENIX Security 2018](https://www.usenix.org/system/files/conference/usenixsecurity18/sec18-vastel.pdf).
- CGNAT IPs rate-limited 3× more often despite lower bot rates — [Cloudflare, Oct 2025](https://blog.cloudflare.com/detecting-cgn-to-reduce-collateral-damage/).
- Coordinated-behaviour detection signals on TikTok (synchronised posting, content reuse, hashtag sequence overlap detected coordination; transcript similarity and Duet/Stitch signals did not) — [ICWSM 2026, 793K videos](https://arxiv.org/abs/2505.10867).
- TikTok's `webmssdk` / `X-Gnarly` / `X-Bogus` signing architecture and its dependence on a real rendering stack — [nullpt.rs](https://nullpt.rs/reverse-engineering-tiktok-vm-1), [X-Gnarly decode](https://github.com/carcabot/tiktok-xgnarly-decoded), [autodev.blog](https://autodev.blog/posts/tiktok-research-article/).
- The CDP `Runtime.enable` signal breaking in May 2025 (with V8 commit hashes) and its March 2026 replacement — [Castle](https://blog.castle.io/why-a-classic-cdp-bot-detection-signal-suddenly-stopped-working-and-nobody-noticed/), [Sveba](https://svebaa.github.io/personal/blog/cdp-fingerprinting/).
- Proxy-vendor session-teardown behaviour (60 s idle) — [Oxylabs session control docs](https://developers.oxylabs.io/products/proxies/residential-proxies/session-control).
- IP-intelligence enums and cross-customer signals (`MINFRAUD_NETWORK_ACTIVITY`, `EMAIL_VELOCITY`, `user_count`) — [MaxMind minFraud docs](https://dev.maxmind.com/minfraud/api-documentation/responses/), [IPQualityScore](https://www.ipqualityscore.com/documentation/proxy-detection-api/response-parameters), [Spur](https://docs.spur.us/context-api).
- ASN and JA3/JA4 as first-class rate-limit keys, and the /64 IPv6 floor — [Cloudflare rate-limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/).

## Claims that are documented but reported rather than directly verified

- **X's consumer account limits (50 posts / 200 replies / 500 DMs / 400 follows per day; 5,000 follow ceiling).** `help.x.com` returned HTTP 403 to every automated fetch attempted, including via text-extraction proxies. These numbers come from search-index snippets of the official help pages plus consistent May 2026 press coverage ([Engadget](https://www.engadget.com/2175771/x-free-accounts-limited-to-50-posts-and-200-replies-a-day/), [Business Standard](https://www.business-standard.com/technology/tech-news/x-introduces-posting-limits-for-unverified-users-here-s-what-has-changed-126051800933_1.html)). **Verify manually in a browser at [help.x.com/en/rules-and-policies/x-limits](https://help.x.com/en/rules-and-policies/x-limits) and [help.x.com/en/using-x/x-follow-limit](https://help.x.com/en/using-x/x-follow-limit) before encoding them.**
- **Instagram's 5-hashtag cap (Dec 2025)** — reported by [Social Media Today](https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/) with Instagram's stated rationale; not located in a first-party help article.
- **TikTok LIVE's 1,000-follower threshold** — appears on TikTok product/support surfaces and is universally corroborated, but was not retrieved verbatim from a first-party URL during this research.
- **Facebook's 5,000-friend cap** — behaviourally certain, first-party help article not retrievable.
- **Threads standalone EU signup** — [Bloomberg](https://www.bloomberg.com/news/articles/2023-12-14/meta-lets-eu-users-sign-up-to-threads-without-an-instagram-link), [Social Media Today](https://www.socialmediatoday.com/news/threads-account-creation-separate-instagram/748530/); a test, not a stable product commitment.

## Claims that are practitioner consensus only

**Everything in every day-by-day schedule table.** All session counts, session durations, per-day action counts, and first-post timings are vendor/operator guidance with no platform backing.

**Sources ranked by operational specificity** (the ones with real numbers and evident first-hand experience):

| Source | Covers | Why it ranks high |
|---|---|---|
| [BHW / ToyBox Marketing, Apr 2025](https://www.blackhatworld.com/seo/the-instagram-warm-up-guide-real-device-automation.1703485/) | Instagram | Literal 18-day table, rest days, per-action-class proxy rotation, post-warmup hourly caps. Most engineering-usable artifact found. |
| [cpa.live, Jun 2026](https://cpa.live/en/articles-en/how-to-farm-tiktok-accounts-from-scratch-a-year-operators-guide/) | TikTok | Day table + session minutes + cohort survival KPIs + unit economics. Reads like someone who ran it. |
| [PhantomBuster support docs](https://support.phantombuster.com/hc/en-us/articles/360015517839-Rate-Limit-Guidelines-for-Social-Network-Automation) | Instagram | **Tool-enforced caps, not opinions** — a vendor that eats its own bans. |
| [Post Bridge](https://support.post-bridge.com/troubleshooting/how-and-why-to-warm-up-a-new-tiktok-account-before-using-post-bridge) | TikTok, Threads | Defines "warmed up" by an **output metric** (500+ avg views/post), the best gating idea in the corpus. |
| [Nelson Creed, Jun 2026](https://nelsoncreed.medium.com/tiktok-farm-on-real-ios-devices-complete-guide-5f712872b5b2) | TikTok | Hardware counts, survival rates, a named failure incident. Self-interested but specific. |
| [TweetAttacksPro, May 2026](https://blog.tweetattackspro.com/X-Accounts-Safety/How-to-Warm-Up-New-X-\(Twitter\)-Accounts-in-2026-Without-Getting-Suspended-\(Complete-Beginner-to-Pro-Guide\)/21010) · [SocialNexis](https://socialnexis.com/guides/twitter-automation-safe-2026) | X | Only concrete X schedules; SocialNexis's percentage-of-cap curve is the cleanest abstraction. |
| [tendX](https://www.tendx.app/blog/x-twitter-limits-2026) | X | Only practitioner source that separates CONFIRMED from REPORTED. |
| BHW threads ([IG Oct 2025](https://www.blackhatworld.com/seo/whats-the-best-way-to-warm-up-new-instagram-accounts.1759531/), [TT Jan 2026](https://www.blackhatworld.com/seo/tiktok-warmup-2026-using-anti-detect-browsers.1784031/), [TT Aug 2025](https://www.blackhatworld.com/seo/how-long-are-you-warming-up-new-tiktok-accounts-in-2025-before-posting-aggressively.1740825/)) | All | Named users, dates, and **visible disagreement** — a good sign. |

### ⚠️ Sources flagged as SEO content-farm output — use only with a hedge

- **[Multilogin contradicts itself across two articles published eight days apart](#instagram-warmup-schedule--practitioner-consensus-undocumented).** Its Instagram numbers differ by ~3× between the [general guide](https://multilogin.com/blog/how-to-warm-up-accounts/) (2 Jul 2026) and the [Instagram-specific guide](https://multilogin.com/blog/mobile/how-to-warm-up-instagram-account/) (10 Jul 2026), with no reconciliation. **Illustrative, not measured.**
- **[GeeLark's statistics are unsourced](https://www.geelark.com/glossary/instagram-action-blocks/)** — "68% of social media managers spend 12.3 hours per month dealing with action blocks," "recovery 1–2 days with GeeLark versus 3–5 manually." Product marketing. Its *ramp* numbers are more plausible than its stats.
- **[Elfsight's Facebook limits page is dated 20 August 2020](https://elfsight.com/blog/facebook-limits-and-blocks-avoiding-account-bans/)** and is the likely origin of most Facebook numbers still circulating in 2026. **Six years stale — do not treat as current.**
- **The "classic Instagram limits canon"** (120 likes/hr, 12–14 comments/hr at 350–400 s intervals, 60 s unfollow interval) traces to 2019–2021 Instagress/Jarvee-era folklore and is internally consistent only because sources copied each other.
- **[Inflowave](https://inflowave.io/resources/instagram-shadowban-2026-complete-guide)** claims "median 14 days based on hundreds of accounts observed" and "roughly 200,000 banned hashtags" with no methodology. Its *recovery ladder* is still the most implementable in the corpus; take the structure, discount the stats.
- **[Replia's Threads numbers](https://replia.net/blog/threads-automation-guide)** (+47% growth uplift, 3.2× more consistent) are marketing.
- **[Kameleo's automation post](https://kameleo.io/blog/how-to-automate-social-media-accounts) is from April 2020** and contains one number. Stale.

### ⚠️ Confirmed absences in the practitioner literature

- **Bright Data, Oxylabs, Decodo/Smartproxy, Soax, Proxy-Cheap and NetNut publish no warmup guidance with numbers.** These vendors publish scraping/proxy-type content only. The only proxy vendors with operational numbers were IPRoyal, NodeMaven and spy.house/HexaProxy.
- **Incogniton, Undetectable (post-2023) and Kameleo publish no current day-by-day schedules.**
- **Combin, Inflact and Jarvee-successor tools publish no explicit limit tables.** PhantomBuster is the only automation vendor still publishing hard numbers.
- **Reddit was inaccessible to this research** — r/socialmedia, r/Instagram, r/TikTokCreators and r/juststart were blocked. **Zero Reddit input in this document.** If you want that sentiment it needs a different retrieval path.

### Known conflicts, with ranges

| Question | Range | Recommendation |
|---|---|---|
| **Instagram first post** | day 1 → day 5–6 → day 7–10 → week 3–4 → not-in-18-days | **Widest disagreement in the whole research.** Default day 7–10; gate on health signals. |
| Instagram warmup total | 7–10 d (Conbersa) · 14 d (shadowphone, 360uniquizer) · 18 d (ToyBox) · 3–4 wk (Multilogin) | 14–18 d |
| Instagram likes/hour | 20 · 10–15 · 120 | ~6× spread. All **[WEAK]**. |
| Facebook warmup total | 7 d (accs-center, Dolphin) · 14 d (Multilogin, BHW) · 30 d (Undetectable) | 14–21 d; longer for ads |
| Facebook first post | day 3–5 · week 3 | Conservative reading |
| Facebook friend requests wk 1 | "avoid entirely" · 5–10/day | Conservative reading |
| TikTok warmup total | 2–3 d (ssemble) · 7 d (BHW modal) · 10–14 d (cpa.live Tier-1) · 15 d | 7–14 d, Tier-1 geos longer |
| TikTok follows/day (new) | 10–20 (Octo) · 50–100 (Conbersa) | 5× spread |
| X follows/day Premium | 400 (businessho) vs 1,000 (tendX) | Direct conflict; verify |
| X posts/day free tier | 2,400 (tendX, Mar 2026) vs **50** (May 2026 change) | The May 2026 change supersedes |
| TikTok flagged-account recovery | 7–10 extra warmup days (cpa.live, Multilogin, Octo) vs **"almost never recoverable, restart instead"** (ssemble) | Commercially significant — measure before choosing |
| Profile completion timing | day 1 (IG/TikTok per Multilogin) vs deliberately incomplete wk 1 (FB per same vendor) | Unexplained asymmetry **[WEAK]** |

## Claims that are weakly sourced — validate before relying on them

- **Instagram now mandating phone verification for all new signups (2026).** Sources are anti-detect-browser and virtual-number vendors — companies selling the workaround. Plausible, unverified, self-interested. **Test empirically.**
- **The "mobile app gets 10× the reach of browser upload" claim for TikTok** ([Nelson Creed](https://nelsoncreed.medium.com/tiktok-farm-on-real-ios-devices-complete-guide-5f712872b5b2)) and the 80–85% vs 10–15% survival figures. Single source, self-interested, no methodology — **and directly contradicted on emulators by a BHW practitioner.** Genuinely contested.
- **Post Bridge's "decline the Threads link at signup."** The only Threads-specific timing advice in existence; single source, retrieved via search index.
- **Facebook's ~1,000 pending-friend-request cap**, and the whole 2020-era Elfsight Facebook table.
- **Threads' "one appeal only"** ([Geelark](https://www.geelark.com/blog/threads-account-banned/)) and its **"60–200 follows per hour" trigger band** ([Postory](https://postory.io/blog/threads-shadowban)) — single-source each.
- **Per-platform proxy-type suitability rankings.** From proxy vendors. The underlying mechanisms are sound; the rankings are marketing.
- **The ISP/static-residential netblock-leasing mechanism.** Vendor-asserted only — no RIR, RFC, or academic source confirms it.
- **Any claim that a specific platform reads a specific fingerprint surface.** The surface *list* is reliable as a superset (FingerprintJS source, Cloudflare's eight categories); per-platform attribution is inference, except for TikTok where the reverse-engineering corpus is real.

## Notable gaps this research could not close

1. **No platform publishes consumer-surface action rate limits.** Not one of the five. Any decision depending on a specific likes/hour number must be validated by your own telemetry, per platform, per cohort, and re-validated over time.
2. **`help.x.com` is not machine-readable.** Cloudflare returns 403 to every automated method. X's consumer limits need manual browser verification.
3. **`transparency.meta.com`, `help.instagram.com`, `facebook.com/help/*` and `support.tiktok.com` are JS-rendered SPAs** returning only `<title>` to non-JS fetchers. Where those URLs are cited, the URL is authoritative but the quoted text came via a text-extraction proxy or search-index render — one indirection removed.
4. **No public reverse-engineering writeup of Meta's web fingerprinting exists**, unlike TikTok's. Treat any specific claim about what Instagram's JS reads as unverified.
5. **Threads has essentially no practitioner literature.** The Threads schedule is the weakest artifact here.
6. **Whether Meta or TikTok run emulation-specific detection on mobile-web flows is unknown.**
7. **No evidence any major social platform cryptographically binds session cookies to IP or ASN.** The practical risk of IP change is a checkpoint, not a logout — but that is inference.
8. **No verified subscribers-per-IP ratio for mobile CGNAT**, and no evidence platforms soften treatment of mobile carrier ASNs.
9. **TikTok's own docs conflict on web upload limits** (30 min/10 GB vs 60 min/30 GB across two first-party pages). Probe empirically.
10. **No first-party source confirms that warmup works.** Every platform documents that scripted engagement is prohibited; none documents a "safe" ramp. The entire warmup discipline is an empirical folk practice built on observed enforcement. **Treat its numbers as initial parameters for an experiment, not as a specification.**

## Highest-value follow-up tasks

1. **Render `help.instagram.com` with your own headless browser and grep every article for the exact string "This feature isn't available on computers, but it is available on these devices."** That yields the definitive first-party app-only feature matrix. It is confirmed present on at least five articles. No blog has this, and it could not be produced here because the help centre is an SPA.
2. **Open the two `help.x.com` limit pages in a real browser and transcribe the current numbers** before encoding them.
3. **Test whether `any-pointer: fine` still evaluates true under Chrome device emulation** — cheap for a detector to check, cheap for you to measure, and currently unverified.
4. **Run your stack against `rebrowser-bot-detector`, `brotector`, CreepJS and `deviceandbrowserinfo.com/are_you_a_bot` before anything else.** The CDP detection landscape changed in May 2025 and again in March 2026; anything validated before that is stale.

## Recommended instrumentation

Given how weak the numeric sourcing is, the system should measure rather than assume:

- **Poll first-party account-state surfaces.** Instagram/Threads **Account Status** (recommendation eligibility, feature restrictions, violations) and TikTok **Account status** are documented, first-party, machine-readable-ish health signals **[DOC]**. These are far better than inferring shadowbans from engagement.
- **Log every action with (profile, proxy, timestamp, action type, outcome).** Action blocks are the ground truth your rate limits should be learned from.
- **Treat rate parameters as per-platform, per-cohort configuration with automatic backoff on block**, halving on block and slowly recovering, rather than fixed constants.
- **Alert on coherence drift**: proxy geo change, timezone mismatch, UA↔Client-Hints mismatch, WebRTC leak, cookie-jar loss. These are the **[DOC]**-supported failure modes and are cheap to detect.
- **Track cohort survival, not just per-account state.** cpa.live's TikTok thresholds are a usable starting template **[PC]**: day-1 registration survival >80%, 7-day warmup survival >70%, 30-day average views/post >200, follow-back rate during warmup 8–15%, week-4 ban rate <25%. Adapt the shape per platform.
- **Measure de-correlation across the fleet as a first-class metric.** Pairwise overlap of posting timestamps, media asset hashes, caption/hashtag sequences, and follow-target sets between your own accounts. These are the signals shown to detect coordination in peer-reviewed work **[DOC]**, and they are entirely within your control — unlike almost everything else in this document.
- **Re-run the automation-detection acceptance suite on every browser/driver upgrade.** The CDP landscape changed twice between May 2025 and March 2026. Treat "our stealth passed six months ago" as no evidence at all.
