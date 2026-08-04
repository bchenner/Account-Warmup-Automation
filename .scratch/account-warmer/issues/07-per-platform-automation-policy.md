# 07 — Per-platform automation policy

Type: grilling
Status: resolved
Blocked by: 01

## Question

For each of Facebook, Instagram, Threads, X and TikTok: which action classes does the app **drive itself**, and which does it **queue for the operator** to perform by hand in the open profile window?

The operator chose "decide per platform" during charting rather than one global policy, so this ticket produces five answers, not one.

The asymmetry to route around: scripted liking and following are named violations on all five platforms `[DOC]` — X ("you may not like posts in an automated manner", no "bulk, aggressive, or indiscriminate" following), TikTok ("bots or scripts to increase likes or shares"), Meta (scripted account use). Consumption is named nowhere. Publishing is sanctioned via API everywhere.

Sharpening points:

- Classify every action into: **app-driven** / **operator-queued** / **not done at all**. Action classes: feed scroll + dwell, video watch-to-completion, story views, search, profile mutations, follows, likes, saves, comments, DMs.
- Consumption is the bulk of warmup *by time* and the least policy-exposed — confirm it is app-driven everywhere unless ticket 01 says the surface can't do it.
- Where an action is operator-queued, decide what "queued" means concretely enough for ticket 16 to design the surface: a checklist, a nudge, a pre-navigated page?
- Meta's Spam policy adds that restrictions "may apply at lower frequencies when other spam indicators are present" `[DOC]` — so the rate budget is a function of overall signal cleanliness, not a fixed number. Decide whether policy is static per platform or responds to health state (ticket 13).
- X and TikTok may end up read-only. Say so explicitly if that's the conclusion rather than leaving it implied.
- ⚠️ **X needs a prior question answered first, from ticket 04**: X documents an allowance of **only 10 accounts, for "different, non-duplicative purposes"** `[DOC]`, with the stated penalty *"choose one account to keep. The remaining accounts will be suspended."* Before deciding X's automation policy, decide **how many X accounts the fleet has and whether they pass the non-duplicative test.** If the fleet is a set of similar avatars, X's own rules say it should not exist at that size — which makes "X is out of scope for the warmer" a legitimate outcome of this ticket, not a failure of it.
- **X's engagement bans are the most explicit of the five** — liking and following are named individually `[DOC]` — so X is the strongest candidate for operator-queued or read-only.
- Encode only the technical numbers from ticket 04, and only as ceilings never approached: the page itself says *"this is a technical account limit only, and there are additional rules prohibiting aggressive following behavior."*

## Answer

### v1 is Facebook, Instagram and Threads only

Operator scoping decision. **X is deferred** — there are no X accounts in the fleet today, so the X adapter is built last or not at all, and the 10-account "non-duplicative purposes" question is revisited only if X ever becomes a real channel. **TikTok is deferred** out of v1 with it, which also defers the mobile question (tickets 08 and 09).

### The action matrix

| Action class | Facebook | Instagram | Threads |
|---|---|---|---|
| Feed scroll + dwell | **app-driven** | **app-driven** | **app-driven** |
| Video watch-to-completion | **app-driven** | **app-driven** | **app-driven** |
| Story views | **app-driven** | **app-driven** | n/a |
| Search (users, tags) | **app-driven** | **app-driven** | **app-driven** |
| Profile mutations — avatar, bio, username, display name, bio link | **app-driven** | **app-driven** | **app-driven** |
| **Follows** | **app-driven** | **app-driven** | **app-driven** |
| Likes | not during warmup | not during warmup | not during warmup |
| Comments | not during warmup | not during warmup | not during warmup |
| Saves | not during warmup | not during warmup | not during warmup |
| DMs | not during warmup | not during warmup | not during warmup |
| Story posting / going live | out of scope (publishing) | IMPOSSIBLE on desktop `[DOC]` | n/a |

### The three rulings behind it

**1. Follows are app-driven on all three, at schedule rate.** 5–10/day, ramping, with the rest days the schedule model (11) will encode. The operator considered a split and landed on uniform automation. The rate is orders of magnitude below Meta's own enforcement language, which ties restriction to *"very high frequencies"* and adds that lower frequencies matter only *"when other spam indicators are present"* `[DOC]` — which is precisely what the rest of this map exists to eliminate. The exposure is real and named; the decision is the operator's and is recorded as taken with that known.

**2. Likes, comments, saves and DMs are not performed during warmup at all** — by the app or by anyone. This is not a risk ruling, it is a scope consequence: those rates belong to *post-warmup steady state*, which the map put out of scope. The published 18-day schedule contains no likes or comments either; its only engagement action is follows. If a future schedule wants them, ticket 11 can add the action class, but the v1 default is off.

**3. Story posting is out of scope even where it works.** Facebook documents a `Computer` tab for story creation `[DOC]`, so desktop *could* do it — but posting is publishing, and the map stops at "warmed". Instagram's is app-only anyway `[DOC]`.

### Threads has a sequencing rule, not a schedule

The standing research is clear that **Threads has no independent warmup**: it inherits the Instagram account's age and trust, shares its session and device, and dies when the Instagram account dies. Two consequences the Threads adapter must respect:

- **Do not auto-link Threads at Instagram signup.** Warm Instagram first, activate Threads later as a deliberate step.
- **Threads and Instagram are one risk pool.** Health state (13) should treat a problem on either as a problem for both, and the de-correlation rules (12) should not treat them as two independent accounts when spreading fleet activity.

### Consequence for the operator surface

**There is no operator action queue in v1.** Ticket 16 was written with the queued-engagement problem as its primary design driver; that driver no longer exists. **[Operator surface](16-operator-surface.md) collapses to account access plus monitoring** — which is a substantial simplification and is reflected there.
