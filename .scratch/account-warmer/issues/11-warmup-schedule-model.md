# 11 — Warmup schedule model

Type: grilling
Status: resolved
Blocked by: 07 ✅ (09 void — TikTok deferred out of v1)

## Question

How is a warmup programme expressed — a declarative schedule the operator can edit, or code per platform?

Sharpening points:

- **Representation**: a data-driven schedule (day → action classes → counts → jitter) in YAML/JSON, versioned per platform, vs hardcoded logic. Given that every published schedule is `[PC]` and the vendors contradict each other, schedules will be tuned repeatedly — argues strongly for data.
- **Reference schedule to model against**: the 18-day Instagram programme is the most engineering-usable in the corpus — days 1–4 story views only, day 5 username change, day 6 display name, day 7 bio+avatar+first photo, days 8–9 follows at 5 then 6, **days 10–11 zero activity**, days 12–15 follows 7→10, day 16 bio link, day 17 rest, day 18 warmed. Note it is the only schedule with deliberate rest days and per-action-class IP handling.
- **Jitter and session windows**: counts must never be exact, times must never be regular. Decide the jitter model and how a day's actions are spread across sessions.
- **Rest days as a first-class concept** — a perfectly-daily account is itself a signal.
- **Ramp after the first post**: cadence does not start at full rate. Decide how the schedule expresses the transition and hands over to `auto-poster`/egged (ticket 17).
- Where sources conflict hardest — Instagram first-post timing spans day 1 to week 4, with one vendor contradicting itself across two articles eight days apart — the schedule should make the number a tunable, not a constant.
- Cross-check against ticket 13: the standing research argues the warmup→production transition should gate on a **measured output signal**, not elapsed days. Decide how a day-indexed schedule and a signal gate coexist.

## Answer

### The model is operator-triggered sessions, run locally — not a scheduler

Operator reframe, and it replaces an assumption several tickets were built on. **There is no autonomous scheduler and nothing runs in the cloud.** The operator picks an account, hits **"Run warmup"**, and the app drives that account's browser through **one session** on this machine. The operator decides how many days to keep doing it.

**The session is the unit of work.** Not the day. Everything below follows from that.

### Progression: a session counter, no guard

Each account carries a **session counter**. "Run warmup" executes script step `n+1` and increments. There is **no minimum-interval enforcement** — the operator controls cadence completely and the app never refuses to run.

⚠️ **Known and accepted trade**, recorded so it isn't rediscovered later: nothing prevents session-15 activity levels landing on a two-day-old account, which is the pattern warmup exists to avoid. The operator was shown this and chose full control.

**Mitigation that respects the decision — advisory, not enforcement:** the run surface displays time-since-last-session and a soft note when it is unusually short ("last session 40 minutes ago"). Information only. **It must never block, delay, or auto-defer a run.**

### Representation: a declarative script, not code

**Session scripts are data — YAML or JSON, versioned, one per platform** — not branching logic in TypeScript. Justification is decisive: every published schedule in the corpus is `[PC]`, the vendors contradict each other and sometimes themselves, and the operator explicitly wants to set the pacing. Schedules will be retuned constantly, and a retune must be a file edit, not a deploy.

A script is an ordered list of **session definitions**. A session definition is an ordered list of **steps**, each naming an action class from ticket 07 with a **range**, never a fixed number:

```yaml
# instagram.yaml — illustrative shape, not final syntax
sessions:
  - id: 1-4          # applies to session indices 1 through 4
    duration: [6m, 11m]
    steps:
      - action: story_views
        count: [10, 15]
        dwell: [2s, 9s]
      - action: feed_scroll
        duration: [90s, 200s]
  - id: 5
    steps:
      - action: profile_mutation
        field: username
      - action: story_views
        count: [10, 15]
```

**Every count and every duration is a range sampled per run.** No fixed numbers anywhere — a session that always does exactly 12 story views is a signature.

### Rest days become light sessions

The 18-day reference schedule's most distinctive feature is deliberate zero-activity rest days — and in a manual model they don't translate, because a rest day is just the operator not clicking, which the app can neither cause nor observe.

**Resolution: rest stages become *light sessions*** — open the profile, brief passive browse, close. They advance the counter and consume a run, but do almost nothing. This preserves the reference schedule's shape without needing a scheduler or a guard, and it matches the standing research's recovery advice to "keep the session alive with passive browsing".

### Per-platform scripts

`facebook.yaml`, `instagram.yaml`, `threads.yaml`. Independent counters per account per platform. **Threads' script is unavailable until its Instagram account is warm** — the sequencing rule from ticket 07, enforced by the app rather than left to the operator.

Length is whatever the script file contains; the operator tunes it. **Where "warmed" is declared is ticket 13's business, not this ticket's** — the script just runs out of sessions.

### Consequences for other tickets

- 🔴 **[Data model (15)](15-data-model.md): BullMQ and Redis may now be unnecessary.** They were inherited from the house stack to schedule unattended work, and there is no unattended work. A session counter and a session log in Postgres may be the whole persistence story. **That ticket must argue the stack rather than inherit it.**
- **[Operator surface (16)](16-operator-surface.md): "Run warmup" is the second primary verb**, beside "Open account". With no action queue (ticket 07) and no scheduler, the surface is: list accounts, open one, run one session, see what happened.
- ⚠️ **[Fleet de-correlation (12)](12-fleet-decorrelation-rules.md) loses its timing lever.** Spreading session times across the fleet was going to be a scheduler responsibility; with manual triggering, **timing is entirely operator behaviour and the app cannot control it.** De-correlation must therefore be enforced on what the app *does* control — seed sets, follow order, content — and the timing risk stated plainly rather than assumed away.
- **[Session durability (18)](18-session-durability.md): recovery becomes advisory too.** With no scheduler there is nothing to automatically back off; a blocked account surfaces its state and the operator decides when to run it again.
