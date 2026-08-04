# 16 — Operator surface

Type: prototype
Status: resolved
Blocked by: 07, 15

## Question

What does the operator actually see and touch?

> **Re-scoped twice — read this before the sharpening points.**
>
> 1. The operator named **account access** as one of the app's two headline features, equal to warmup. The "open a profile by hand" capability is not a convenience — **it is half the product**, and this ticket owns its design.
> 2. ⚠️ **Ticket 07 removed this ticket's original primary driver.** Follows are app-driven on all three v1 platforms and no engagement is operator-queued, so **there is no action queue in v1.** Everything below about presenting a checklist of things for the operator to click is now moot. Strike it.
>
> **What remains is much smaller: account access plus monitoring.** Pick any account; be inside it, logged in, on the right IP, in one action. See at a glance what's due, what's mid-session, what's blocked, what's warmed. That is the whole surface — which makes "is a web panel worth building at all, or is a CLI plus good logs enough?" a much more live question than when this ticket was written.

Sharpening points:

- **Account access is the primary surface.** One action opens a chosen account's profile with its proxy attached and its session intact. It must be fast, it must be impossible to open on the wrong IP (fail-closed, per the map's non-negotiables), and it must not perturb the fingerprint or session invariants that tickets 06 and 18 establish. Decide what happens when the operator closes the window mid-warmup-session.
- **The queued-actions problem is the second driver.** The per-platform policy (07) will route some engagement to the operator by hand. That queue needs a home: a list of "do these five things in this open window", presented so the operator isn't hunting for the right tab. Design this first — it's the part with no obvious precedent.
- **CLI vs web panel.** `dm-engine` ships a Fastify + SPA admin panel; `auto-poster` is headless. At 10–30 accounts, decide whether a panel earns its build cost or a CLI plus good logs is enough.
- **The daily view**: which accounts are due, which are mid-session, which are blocked, which are warmed and ready to hand to egged.
- **Launching a profile by hand** — the operator will need to open a profile with its proxy attached to check something or clear a challenge. This should be one command or one click, and must not break the fingerprint or session invariants.
- **Health at a glance** (ticket 13's state), and what an alert looks like when a profile hits a checkpoint at 3am.
- Prototype this as a rough artifact to react to, not a finished UI.

## Answer

### An Electron desktop app, matching the `orbit` precedent

`app-tracker-electron` (`orbit`) establishes the house pattern and it is a clean fit: **electron-vite + React 18 + Tailwind + TypeScript + electron-builder**, laid out as `src/{main,preload,renderer,shared}`.

**Why it fits better than the alternatives here:** the main process is Node, so it can own Playwright, the Chrome child processes, and all file I/O directly — and the renderer talks to it over **IPC**. That means:

- 🔴 **Fastify is now definitively out of the stack.** It was the last thing keeping an HTTP surface alive, and IPC replaces it. Combined with tickets 11, 14 and 15, **the app has no HTTP server, no queue, no database and no secrets.** Nothing to start before you can use it.

### Process split

**Main process owns everything privileged:** launching Chrome with `--user-data-dir` and `--proxy-server`, the pre-flight egress-IP assertion (ticket 05), running session scripts via Playwright, reading and writing the YAML/JSONL tree, and the follow registry's in-memory set.

**Renderer is presentation only.** It never touches the filesystem or a browser — it renders state and sends intents.

### The two primary verbs

Both operate on a selected account, and they are the whole product:

1. **Open** — launch the profile on its bound IP, fail-closed, and hand the window to the operator. This is the "account access" half of the destination. Must be one click and must be impossible to open on the wrong IP.
2. **Run warmup** — execute the next session in the script, increment the counter.

### The main view

A list of accounts grouped by persona, each row showing: platform · username (or *not yet registered*) · session counter and script length · health state (ticket 13's state machine) · time since last session.

- **The advisory from ticket 11 lives here**: time-since-last-session is displayed, with a soft note when it is unusually short. **Non-blocking, always** — it must never delay or refuse a run. The operator explicitly chose no guard.
- **Live session view** while a session runs: which step, what it is doing, how far through. With no scheduler and no AI, a session is a deterministic script — showing its position is cheap and makes failures legible.
- **Health state is the other at-a-glance signal**, shared across the IG+Threads pool per ticket 07.

### Proxy management is a first-class surface

**The operator adds and manages proxies in the app.** No config files to hand-edit, no dependency on anyone else to set one up. A **Proxies** view over the `data/proxies.yaml` pool (ticket 15):

- **Add** — paste `host:port` (one at a time or a pasted batch, since vendors deliver lists), set country and rental expiry.
- **Verify** — a button per proxy, and automatically on add. The app runs the checks itself:
  1. **Egress IP** — resolve the public IP through the proxy. Establishes the bound IP and proves the proxy works at all.
  2. **Geo** — confirm the reported country matches what was purchased, since vendor-claimed geo and what the geo databases report do not always agree.
  3. **Classification** — confirm it types as ISP/residential rather than datacenter or hosting, and record the ASN. This is the baseline that makes a later silent swap detectable.
  4. **TLS fingerprint** — fetch a TLS-fingerprint echo endpoint directly and through the proxy, and compare. **Identical means a clean tunnel; different means the product is decrypting and re-encrypting, which replaces Chrome's genuine ClientHello and defeats the whole fingerprint layer.** A proxy failing this must be blocked from assignment, not merely flagged.
- **Assign / unassign** to a profile, enforcing the one-proxy-one-profile uniqueness rule.
- **Re-verify on demand and surface expiry** — verification is not a one-time gate. Rental renewal is when an IP silently changes (ticket 05), so the view sorts by expiry and re-running verification is one click.

**Why this is in the product and not a setup script:** every one of these checks has to run again on every renewal and every re-bind. A check that only runs once is a check that stops being true.

### Onboarding flow (ticket 14)

A first-class wizard, because profile creation now precedes account creation: create account record (platform, country, niche, persona) → app provisions profile directory and binds proxy → **Open** → operator registers by hand in that window → mark registered → session 1 unlocks.

### Native notifications

Electron's `Notification` API, used for exactly one thing: **a session has stopped and needs the operator.** A checkpoint, action block, captcha or logout mid-session (ticket 13's detection) fires a toast, because sessions run for minutes and the operator will be elsewhere.

Deliberately *not* notified: session completion, or anything routine. A notification that fires constantly gets ignored, and then the one that matters gets ignored with it.

### Struck from this ticket

⛔ Everything about presenting a **queue of actions for the operator to click** — ticket 07 made all follows app-driven, so no engagement is ever operator-queued. That was this ticket's original primary driver and it no longer exists.
