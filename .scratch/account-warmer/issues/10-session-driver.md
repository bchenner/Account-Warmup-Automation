# 10 — Session driver and automation-detection hardening

Type: grilling (respecified from `prototype` — the empirical run moves into the build)
Status: resolved
Blocked by: 06 ✅

## Question

How is a warmup session actually executed against a real Chrome — and what drives it without being detectable as a driver?

Sharpening points:

- **Driver choice**: Playwright persistent context vs CDP-attach to an independently-launched Chrome vs a patched driver. The standing research is emphatic that injection-based stealth is dead — `puppeteer-extra-plugin-stealth` last shipped March 2023, and Castle demonstrated detecting CDP-injected spoofing as CDP-injected spoofing. Current viable approaches named: **rebrowser-patches**, **patchright**, or patched browsers.
- **The CDP-attach question is load-bearing**: 21% of the Tranco Top 10K probe for Chrome DevTools, and the March 2026 prototype-chain Proxy trap was unpatched at time of research. If we attach via CDP at all, prove the trap doesn't fire.
- **Known driver tells to verify absent**: `navigator.webdriver`, `//# sourceURL=pptr:` in `Error.stack`, `__pwInitScripts` in global scope, `window.cdc`, disabled CSP (no real browser disables CSP), `Input.coordinatesLeak`, "Google Chrome for Testing" in the UA.
- **Human-like execution**: how "scroll the feed for four minutes" is implemented — dwell distribution, scroll cadence, whether the mouse moves, typing rhythm for search. Note the detector that flags `canvas.arc()` drawn within ±5px of the cursor, and that `Event.isTrusted` distinguishes synthetic events.
- 🔴 **Selector strategy is the highest-stakes decision in this ticket**, because the map's no-AI constraint means there is **no intelligent fallback when a selector breaks** — no model reading the page, no vision-based recovery. A broken selector is a broken session, full stop. Decide the approach (semantic/ARIA vs CSS vs text-anchored) and put selectors in **data, not code**, so drift is a file edit. Three v1 platforms rather than five makes this tractable, and Facebook/Instagram/Threads share Meta front-end conventions.
- **Fail loudly on selector miss.** A script that cannot find its target must abort the session and report which selector failed — never continue, never guess, never approximate. Silent partial sessions are worse than no session, because the account's state diverges from what the counter believes.
- Deliverable: one profile completing one realistic read-only session end-to-end behind a proxy, passing the ticket 06 acceptance suite while doing it.

## Answer

### Driver: patched Playwright (`patchright`), persistent context

**There is no CDP-free option.** Playwright drives Chrome over CDP, and 21% of the Tranco Top 10K probe for DevTools `[DOC]` — so the question is not whether to use CDP but whether the known leaks are patched.

- **`puppeteer-extra-plugin-stealth` is out**: last shipped March 2023, and it patches by *injection*, which the map's non-negotiables forbid and which Castle demonstrated detecting directly.
- **`patchright`** — a drop-in patched Playwright — is the current answer: it closes the driver leaks at the library level rather than by injecting scripts into the page.

⚠️ **This is a dependency on a third-party patch in an active arms race.** The May 2025 → March 2026 inflection (the classic `Runtime.enable` signal dying and being replaced by an unpatched prototype-chain Proxy trap) is the proof. **Pin the version, and re-run the ticket 06 acceptance suite on every upgrade** — a stealth patch validated last year is not evidence about this year.

**Persistent context, always** — `--user-data-dir` per profile is the identity (ticket 15), so a fresh context is never acceptable.

### Input: drive through CDP, never through injected JS

A useful asymmetry: **`Event.isTrusted` is `true` for input dispatched via CDP** (`Input.dispatchMouseEvent`, which is what Playwright's mouse and keyboard use) and `false` for events synthesised in page JavaScript. So the driver's native input path is *better* than scripting clicks, not just more convenient.

Two specific tells to avoid, both from `brotector`:

- **`canvasMouseVisualizer`** flags `CanvasRenderingContext2D.arc` calls within ±5px of the current cursor. Do not draw debug overlays or cursor trails.
- **`Input.coordinatesLeak`** (Chromium bug 1477537) — verify absent in the pinned `patchright` build.

### Human-like execution, deterministically

Everything is sampled from ranges defined in the session script (ticket 11) — no AI, no adaptive behaviour, and **no fixed values anywhere**, since a session that always dwells exactly 4s is a signature:

- **Dwell** per item, sampled per item, not per session.
- **Scroll in increments with pauses**, not one continuous jump to the bottom.
- **Video watch-to-completion** means actually remaining on the item for its duration.
- **Typing with inter-key delays** for search.
- **Mouse movement between targets** rather than teleporting — Playwright's `mouse.move` with intermediate steps.

### Selectors: data, not code — and this is the highest-stakes choice

**No intelligent fallback exists** (no LLM, no vision), so a broken selector is a broken session, full stop.

- **Selectors live in per-platform data files**, versioned alongside the session scripts, so drift is a file edit rather than a code change and a deploy.
- **Strategy: ARIA role and accessible name first, stable `data-*` attributes second, visible text third, CSS class last.** Meta ships obfuscated, build-hashed class names — anything anchored to them breaks weekly. All three v1 platforms share Meta front-end conventions, which makes one selector vocabulary go a long way.
- **Fail loudly**: a selector miss **aborts the session and reports which selector failed**. Never continue, never guess, never approximate — a silent partial session leaves the account's real state diverged from what the counter believes, which is worse than no session at all.
- **Do not auto-advance the session counter on an aborted session** (ticket 18).

### Acceptance, specified for the build

Same suite as ticket 06, plus: **one profile completes one realistic read-only session end-to-end behind its proxy, passing the detector suite while doing it.** That remains the real proof — it just happens during the build, against the real app, rather than as a precondition to writing the spec.
