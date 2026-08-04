# 12 — Cross-account de-correlation rules

Type: grilling
Status: resolved
Blocked by: 07

## Question

What must the app guarantee **across the fleet** so that 10–30 accounts are not detectable as one operator's network?

This is the exposure that fingerprint and proxy hygiene cannot touch, and the evidence is strong. A peer-reviewed 793,000-video TikTok study (ICWSM 2026) found the signals that detected coordination were **synchronised posting times, reused media assets, and overlapping caption/hashtag sequences** — while transcript similarity and Duet/Stitch signals did *not* detect it. X prohibits "posting identical or substantially similar content across multiple accounts" and "coordinating to exchange engagement" `[DOC]`. Meta names spam networks creating "hundreds of accounts to share the same spammy content" `[DOC]`.

Sharpening points:

- **Hard invariants the app should enforce by construction, not by policy.** Candidates: no two managed accounts ever follow each other; no two follow the same seed set; no two follow the same account in the same order; no asset is reused across accounts; session start times are spread, not staggered by a constant.
- **Where is this enforced?** A scheduler constraint, a database uniqueness rule, or a pre-flight check that refuses the action. Prefer the layer where violating it is impossible.
- **The 7-day IP-level signal**: Fingerprint's `timezone_mismatch` also fires when ≥50% of requests from one IP over 7 days show a mismatch `[DOC]` — a reminder that some checks aggregate over time and across accounts, so per-session correctness is not sufficient.
- ⚠️ **Timing de-correlation is no longer available to the app** (ticket 11). Sessions are operator-triggered on a local machine with no scheduler, so **the app cannot spread session times across the fleet** — timing is whatever the operator's clicking pattern happens to be. This matters because synchronised timing is one of the three signals the 793K-video study found actually detected coordination.
  - Decide what to do about it, honestly. The realistic options are: surface it (show the operator when accounts were last run, so *they* can spread the load), constrain it (refuse nothing, but warn when N accounts have run within the same hour), or accept and document it as a known residual risk.
  - Do **not** design a fleet-wide spreading algorithm — there is no scheduler to execute it.
- **What the app *can* still control**: seed sets, follow order, and content. Those become the whole de-correlation surface, which raises their importance rather than lowering it.
- **X gives the corpus its only hard number on fleet size** (ticket 04): up to **10 accounts** for *"different, non-duplicative purposes"* `[DOC]`, enforced by *"choose one account to keep. The remaining accounts will be suspended."* No other platform publishes a count. Decide whether the app enforces a per-platform account-count ceiling at all, and whether "non-duplicative purposes" is something the data model can even represent (ticket 15) or is purely an operator judgement.
- **X also names the engagement-exchange failure explicitly** — *"coordinating to exchange engagement in any X features, such as Likes, Polls, Replies, Reposts, Lists, Views, or Follows"* `[DOC]` — which is the documented form of the "no two managed accounts engage with each other" invariant above. Cite it rather than the `[PC]` sources.
- This ticket likely graduates the "seed-set strategy" fog on the map — expect to spawn a follow-up.

## Answer

### The surface is much narrower than this ticket assumed

The 793K-video study's three detecting signals — **synchronised posting times, reused media assets, overlapping caption/hashtag sequences** — are *all publishing behaviours*. **This app never publishes**, so none of them is in its power to cause or prevent; they belong to egged, which is out of scope. Device and IP clustering is already eliminated by ticket 05's one-static-IP-per-profile rule.

**What remains is the follow graph, and nothing else.** That is the whole of this ticket.

### Seed sets: persona niche → scripted on-platform search → global registry

Each account carries a **niche** (its content topic, operator-supplied). Follow targets are found by **scripted native search** on that niche — search term from config, results list, take candidates in order — and filtered through a **global follow registry** before any follow executes.

Fully deterministic per the no-AI constraint: no model judges relevance, ranks candidates, or decides who is "a good follow". The niche term is data, the search is scripted, the pick is positional, the filter is a database query.

### The invariants, enforced by construction

Enforced in the **follow action's pre-flight**, which consults the registry and skips to the next candidate rather than failing the session:

1. **No two managed accounts ever follow each other.** Any candidate that is itself a managed account is skipped, on any platform.
2. **Zero shared follow targets across the fleet, by default.** A target followed by one managed account is unavailable to every other. Configurable upward, but 0 is the default and should stay there — at roughly 100 targets per account over a full warmup and distinct niches per persona, disjointness is achievable without distorting behaviour.
3. **Follow order is shuffled per account.** Two accounts drawing from an overlapping candidate pool must never traverse it in the same sequence.
4. **Instagram and Threads count as one account** for all of the above (ticket 07's shared-risk-pool rule). A target followed by an account's Instagram is unavailable to its Threads, and both are unavailable to every other account.

**Where it lives:** ⚠️ **superseded by ticket 15.** This ticket specified a `follow_target` table whose uniqueness would be a database constraint — "impossible rather than discouraged". **Ticket 15 chose files on disk, so there is no database and no constraint.** The registry is `registry/follow-targets.jsonl`, append-only, loaded into an in-memory set at session start and checked before every follow. Reliability now rests on the **single-writer guarantee** (one operator, one session at a time, no interleaving) rather than on the storage engine. The four invariants above are unchanged; their enforcement is weaker, and that is recorded rather than papered over.

### Timing: accepted residual risk, no product feature

Ticket 11 removed the app's ability to spread session times, since sessions are operator-triggered with no scheduler. **The operator has accepted this as residual risk** — no last-run surfacing, no clustering warning, no suggested running order. Nothing is built for it.

**Recorded plainly so it is not mistaken for an oversight:** fleet-level session-time clustering is possible and the product will neither prevent nor report it. The mitigating context is that the study's timing signal was specifically *posting* time synchronisation, which this app cannot cause. The exposure is that warmup sessions themselves cluster if the operator batches them.

### Fog graduated

The map's **"seed-set strategy"** fog patch is specified by this answer and is cleared from *Not yet specified*.
