# 04 — Manually verify X's documented account limits

Type: task (HITL)
Status: resolved
Blocked by: —

## Question

Nothing to decide — a fact-gathering task that unblocks the X side of tickets 07 and 11.

`help.x.com` returns **403 to all automated access**, so the standing research could not verify X's published account limits directly and had to rely on secondary reporting. The numbers currently in circulation conflict.

Operator checklist — open these in a normal browser and record the verbatim numbers:

1. `help.x.com` → account limits page: daily post limit, daily DM limit, daily follow limit, and the follow-ratio rule (the "5,000 following" threshold and what happens past it).
2. The Automation Rules page: confirm the exact wording on automated liking and bulk following.
3. The developer rate-limit docs for any endpoint we might use for health polling.

Record each number with its URL and the date read, since these change without notice. Anything not found on an X-owned domain stays labelled `[PC]`.

Resolution should paste the verbatim quotes into the `## Answer` block so later tickets can cite them without re-fetching.

## Answer

**Resolved AFK, not by the operator.** Ticket 01 found the route: `help.x.com` 403s direct fetches but is reachable via `https://r.jina.ai/<url>?x=1`, where the cache-busting param matters because the proxy otherwise serves a cached 403. **Control run this session: a direct fetch of the same URL returned HTTP 403; the proxied fetch returned the article.** All quotes below were read this session, 2026-08-03.

⚠️ **Two-hop caveat, same as ticket 01**: these passed through a rendering proxy and then a summarising model. The figures are reliable; spot-check exact wording in a browser before hardcoding a quote.

### Account limits — [Understanding X limits](https://help.x.com/en/rules-and-policies/x-limits) `[DOC]` (page updated 2026-05-15)

| Limit | Verbatim | Window |
|---|---|---|
| **Posts** | *"50 original posts and 200 replies per day for unverified accounts"* | per day |
| **Direct Messages** | *"The limit is 500 messages sent per day."* | per day |
| **Follows** | *"The technical follow limit is 400 per day."* | per day |
| **Following cap** | *"Once an account is following 5,000 other accounts, additional follow attempts are limited by account-specific ratios"* | account-level |
| **Email changes** | 4 per hour | per hour |
| **Likes / Reposts** | **Absent from the page** — no documented figure exists | — |

**⚠️ The 2,400/day figure is stale text on the same page.** It appears under *"What happens if I hit a limit?"* (*"The post limit of 2,400 updates per day is further broken down into semi-hourly intervals"*), while **50 + 200 appears under "Current X limits"**. Same page, two eras. **Use 50 + 200; treat 2,400 as legacy** and do not let it into config.

**The most important sentence on the page**, because it says the technical limit is not the safe limit:

> *"Please note that this is a technical account limit only, and there are additional rules prohibiting aggressive following behavior."*

Also documented: limits span all devices and platforms, and may be temporarily reduced during high-traffic periods.

### Follow limits — [What is the X follow limit and ratio?](https://help.x.com/en/using-x/x-follow-limit) `[DOC]`

- *"Every X account is able to follow up to 400 accounts per day."*
- *"Every X account can follow up to 5,000 accounts. Once you reach that number, you may need to wait until your account has more followers before you can follow additional accounts."*
- The ratio is *"automatically calculated based on your unique ratio of followers to following"* — **not a published number**, so it cannot be encoded, only observed.
- Block message: *"You are unable to follow more people at this time."*
- **Documented recovery paths** — the only per-cause backoff any of the five platforms publishes: daily limit → wait 24 hours · followed too quickly → wait ~1 hour · ratio limit → gain followers or unfollow.

### Automation rules — [X's automation development rules](https://help.x.com/en/rules-and-policies/x-automation) `[DOC]` (updated April 2026)

- *"You may not like posts or hide replies in an automated manner."*
- *"You may not follow or unfollow X accounts in a bulk, aggressive, or indiscriminate manner."*
- *"You may not send unsolicited Direct Messages in a bulk or automated manner, and should be thoughtful about the frequency."*
- *"You may not create and/or automate multiple accounts for duplicative or substantially similar use cases."*
- Permitted: *"You may post automated posts based on sources of outside information — such as an RSS feed, weather data, etc."*

### Authenticity policy — [Authenticity](https://help.x.com/en/rules-and-policies/platform-manipulation) `[DOC]` (updated April 2025)

- **A documented account-count allowance: up to 10 accounts, for *"different, non-duplicative purposes."*** This is the only hard number on multi-account operation found anywhere in the five-platform corpus.
- Prohibited: *"operating multiple accounts that post substantially similar or identical content"*, including *"cross-posting content across multiple accounts"*.
- Prohibited: *"coordinating to exchange engagement in any X features, such as Likes, Polls, Replies, Reposts, Lists, Views, or Follows"*.
- Prohibited: **follow churn** and **indiscriminate following** *"particularly by automated means."*
- Enforcement ladder: anti-spam challenges → *"restricting reach"* (exclusion from search and trends) → *"temporary loss of access to X features"* → suspension.
- **For multi-account violations specifically:** users *"may be asked to choose one account to keep. The remaining accounts will be suspended."*

### API rate limits — [docs.x.com](https://docs.x.com/x-api/fundamentals/rate-limits) `[DOC]`

| Endpoint | Per user | Per app |
|---|---|---|
| `POST /2/tweets` | 100 / 15 min | 10,000 / 24 hrs |
| `POST`/`DELETE /2/users/:id/likes` | 50 / 15 min, 1,000 / 24 hrs | — |
| `POST`/`DELETE /2/users/:id/following` | 50 / 15 min | — |
| User lookup | 900 / 15 min | 300 / 15 min |

Limits are split by auth method (per-app Bearer vs per-user OAuth), **not** by access tier — Free/Basic/Pro do not change these figures.

### Consequences for the map

1. **X's 10-account allowance and the "non-duplicative purposes" test are the sharpest constraints found for a multi-avatar fleet on any platform.** If the fleet exceeds 10 X accounts, or if avatars are substantially similar in purpose, the documented enforcement is *choose one, the rest are suspended*. **Feeds ticket 12 directly, and needs a plain answer in ticket 07 about whether X belongs in the fleet at all.**
2. **X's engagement automation ban is unusually explicit** — liking and following are named individually. Combined with (1), the honest reading is that X is the platform least compatible with app-driven engagement.
3. **The 5,000 ratio rule cannot be encoded** — it is deliberately unpublished. It must be *observed* from the block message, which makes it a ticket 18 detection case rather than a ticket 11 schedule constant.
4. **Only the technical numbers are safe to encode.** The page states outright that the technical limit is not the behavioural one, so 400 follows/day belongs in config as a ceiling never approached — not as a target.

