# 18 — Session durability and profile custody

Type: grilling
Status: resolved
Blocked by: 14

## Question

How does an account, once accessible, **stay** accessible — indefinitely, without re-login, without losing its browser identity?

Graduated from the map's fog when the operator scoped the app to two features: **account access** and **warmup**. Access is not a one-time login; it is a property that has to hold for months. This ticket owns "staying in", where ticket 14 owns "getting in".

Sharpening points:

- **Profile custody.** The `--user-data-dir` *is* the account's identity — it holds `datr`/`sb` (2-year Meta identities serving "security and site integrity"), `ttwid` (TikTok's 1-year anti-fraud identity), and every device cookie the platforms generated from the real rendering stack. **Losing the directory means losing the account's accumulated history**, which no amount of re-login restores. Decide the backup strategy, its cadence, and how a restore avoids looking like a device change.
- **Backup is not trivial** — these directories are large, constantly mutating, and locked while Chrome runs. Decide whether backups happen only between sessions, whether they are full or incremental, and how many generations are kept.
- **Detecting the four failure states and telling them apart**: silent logout · checkpoint/verification challenge · soft action-block · full ban. They demand completely different responses, and confusing a checkpoint for a ban wastes an account. This is the detection half of what ticket 13 measures.
- **The recovery protocol**, consistent across every source in the standing research: stop the blocked action class entirely, **do not retry** (retrying extends blocks) `[PC]`, keep the session alive with passive browsing, resume at roughly half the prior rate. ⚠️ **Per ticket 11 there is no scheduler, so none of this can be automatic** — nothing runs unattended to back off. Recovery is *advisory*: the app detects the state, displays it, and recommends the response; the operator decides when to run the account again. The "keep the session alive with passive browsing" step maps directly onto ticket 11's **light session**.
- **Documented backoffs to encode**: Meta's strike ladder 1/3/7/30 days `[DOC]`; TikTok strikes expire after 90 days `[DOC]`. Everything else is `[PC]` and belongs in config, not code.
- **Quarantine state**: what an account in trouble is allowed to do, and what re-admits it to its schedule.
- **Proxy custody is part of session custody**, and ticket 05 made this concrete: Proxy-Seller — like every vendor except Decodo — **does not document whether an IP survives rental renewal.** So a silent IP change is an expected event, not an edge case.
  - The **per-session pre-flight egress-IP assertion** from ticket 05 is what detects it: resolve the public IP through the proxy, abort unless it matches the profile's bound IP. This ticket owns what happens *after* that abort.
  - Decide the **re-bind ritual**: an account whose IP changed under it has effectively moved house. Does it resume immediately, pause for a cooling period, or drop to a reduced schedule? Note this is the one case where an IP change is *not* our choice, so the usual "never change IP" rule cannot be obeyed — only handled.
  - NetNut's seizure is proof that whole-vendor loss is not hypothetical either. The stored IP/ASN/country/classification per profile (ticket 15) is what makes a forced migration a controlled re-bind against matched replacements rather than a scramble.

## Answer

### Profile backup: everything except the caches, after every session

**Back up the profile directory excluding the disposable caches** — `Cache/`, `Code Cache/`, `GPUCache/`, `Service Worker/CacheStorage/`, `DawnCache/`. Those are HTTP and shader caches: large, constantly rewritten, and **carrying no identity**. Excluding them cuts a profile from hundreds of megabytes to tens, which is what makes frequent backup affordable.

**What must be preserved is the identity surface**: `Cookies` (holding `datr` and `sb`, Meta's 2-year identities described as serving *"security and site integrity"* `[DOC]`), `Local Storage`, `IndexedDB`, `Preferences`, and `Local State`.

- **Cadence: after every session.** Cheap once caches are excluded, and it means the worst case is losing one session's worth of history.
- **Only between sessions, never while Chrome is running.** The files are locked and a mid-write copy is a corrupt copy. The main process already knows when a session ends (ticket 16), so this is a natural hook.
- **Keep the last 3 generations plus one operator-pinned "known good."** Generations churn; the pin does not.
- **A restore is not a device change**, and this is the whole point — the identity cookies come back with it, so the browser presents as the same browser it was. This is why backup is worth doing at all: a lost profile directory cannot be recovered by logging in again.

### Quarantine: light sessions only

An account in any non-`ok` health state (ticket 13) is **restricted to light sessions** — ticket 11's open-browse-briefly-close step. That is exactly what the recovery protocol every source agrees on calls for: *keep the session alive with passive browsing*, while performing none of the blocked action classes.

**The operator clears the state to resume normal sessions.** Nothing clears automatically, because with no scheduler there is nothing running unattended to decide it is safe. The app displays the documented guidance — Meta's 1/3/7/30-day strike ladder `[DOC]`, TikTok's 90-day expiry `[DOC]` — and labels everything else `[PC]`.

**Never retry the blocked action**, and never auto-advance the counter past a failed session. Retrying extends blocks, and a session that aborted did not happen.

### Proxy re-bind: an expected event, not an edge case

Proxy-Seller — like every vendor except Decodo — does not document whether an IP survives rental renewal (ticket 05). So:

- The **pre-flight egress-IP assertion** runs at the start of every session and aborts if the IP is not the profile's bound IP.
- On abort the profile enters **`ip_changed`**, which is an operator decision, not an automatic recovery. Two paths: **accept** the new IP (update `profile.yaml`, keeping the old IP in history) or **replace** it with a matched substitute from the vendor.
- **Resume on a light session first**, whichever path is taken. The account has effectively moved house, and the one rule this design otherwise never breaks — never change IP — has been broken by the vendor rather than by us. It cannot be obeyed, only handled.
- **Rental expiry is surfaced in the UI ahead of time**, since expiry is when this is most likely. Cheap early warning: the date is already stored next to the IP.

### Failure-state detection

Owned by ticket 13 — in-session only, five states, abort and report, never retry. This ticket owns what happens *after* that: quarantine, backup integrity, and re-bind.

### What is deliberately not built

⛔ **No automatic recovery of any kind.** No auto-backoff, no auto-resume, no scheduled retry. There is no scheduler (ticket 11), so there is nothing running that could make those decisions — and the operator is present at every session by construction. **The app detects, records, displays and recommends. The operator decides.**
