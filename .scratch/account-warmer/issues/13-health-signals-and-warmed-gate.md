# 13 — Health signals and the "warmed" gate

Type: grilling
Status: resolved
Blocked by: 07, 09

## Question

What does the app measure to know an account is healthy, and what condition promotes it from warmup to production?

The standing research's ninth finding argues this is the highest-leverage design choice available: no two vendors agree on when the first post is safe (Instagram estimates span day 1 to week 4), so **elapsed days is a poor gate** and a measured output signal is a better one.

Sharpening points:

- **First-party signals to poll.** Instagram and Threads expose **Account Status** with recommendation eligibility `[DOC]` — a real, first-party shadowban indicator rather than an inference. Establish the equivalent, or the absence of one, for Facebook, X and TikTok.
- **Output-threshold gates.** One vendor defines "warmed" for TikTok as **500+ average views/post** `[PC]`. ⚠️ **Probably unusable here**: the app is scoped to access + warmup and never posts, so it has no posts to measure and no reach data flowing back from the poster. Decide whether "warmed" can be defined on *consumption-side* and *account-status* signals alone — and if it genuinely cannot, say so plainly rather than smuggling posting back into scope.
- **Scope note**: this ticket defines *when warmup is done*. It does **not** define what happens next — handoff, steady-state caps and keep-warm activity are all out of scope on the map.
- **Negative signals**: action blocks, checkpoint challenges, forced re-login, "try again later", captcha, feature-limit banners. Each needs a detector and a distinct response.
- **The strike ladders that are documented**: Meta's is 1/3/7/30 days `[DOC]`; TikTok strikes expire after 90 days `[DOC]`. These are the only numeric backoffs any platform publishes — everything else is `[PC]`.
- **The recovery protocol** is consistent across every source: stop the blocked action class entirely, **do not retry** (retrying extends blocks), keep the session alive with passive browsing, resume at roughly half the prior rate. Decide whether this is automatic or requires operator sign-off.
- Decide what health state actually *is* in the data model, since ticket 15 has to store it: a scalar score, a state machine, or a per-action-class budget.

## Answer

### The gate: script completion, and nothing else

**An account is warmed when it finishes the last session in its script.** Deterministic, nothing to poll, nothing to parse, no threshold invented from evidence nobody has. Operator's decision.

The vendor "500+ average views/post" definition is **unusable here and formally discarded** — the app never posts and no reach data flows back from egged (out of scope). It should not be reintroduced.

⚠️ **Known limitation, recorded so it isn't mistaken for an oversight:** this gates on *effort expended*, not on *account health*. An account that was action-blocked at session 9 still arrives at session 18 and is declared warmed. The detection below is what stops that being invisible — but the gate itself will not hold an account back, and the operator is the one who reads the state before trusting it.

### Detection: in-session only, no polling

**While a session runs, the script watches for the states it would trip over anyway** — this is free, because the browser is already there and already navigating:

- **action block** — the feature-limit banner ("Try Again Later", "You're temporarily blocked")
- **checkpoint** — a verification or identity challenge interrupting the flow
- **logged out** — a login screen where an authenticated surface was expected
- **captcha** — a challenge gate
- **banned** — an account-disabled screen

On any of these the session **aborts immediately, records the state, and reports it.** No retry — the standing research is consistent across every source that retrying extends blocks `[PC]`. Consistent with ticket 10's fail-loudly rule: never continue, never guess.

**No separate Account Status poller in v1.** It is an extra surface to build and parse, it exists only on Instagram/Threads (Facebook's equivalent was never verified), and the gate does not consume it. Revisit if in-session detection proves too coarse — the `[DOC]` recommendation-eligibility signal is genuinely the best first-party health evidence available on these platforms, so this is a scope call, not a judgement that it's worthless.

### Health state: a small state machine, per account per platform

Not a scalar score — there is nothing to score with. Not a per-action-class budget — the script defines counts, so there are no budgets to track.

`ok` · `action_blocked` · `checkpoint` · `logged_out` · `captcha` · `banned`

Set by in-session detection, cleared by the operator. Goes to ticket 15 as an enum column, and Instagram and Threads share a pool per ticket 07 — a problem on either should be visible on both.

### Recovery is advisory, per tickets 11 and 18

No scheduler means nothing runs unattended, so nothing can automatically back off. The app **records the state, displays it, and shows the recommended response**; the operator decides when to run the account again. The documented backoffs — Meta's 1/3/7/30-day strike ladder `[DOC]` — are displayed as guidance and live in **config, not code**. Everything else in the corpus is `[PC]` and must be labelled as such wherever it is surfaced.

The recommended response itself is the one every source agrees on: stop that action class, do not retry, keep the session alive with passive browsing — which is exactly ticket 11's **light session**, so the operator has a concrete thing to run rather than only being told to wait.
