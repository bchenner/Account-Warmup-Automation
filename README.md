# Boiler

A desktop app for **account access** and **warmup** across Facebook, Instagram and Threads.

Two things, done carefully:

1. **Account access** — one Chrome profile per identity, each pinned to its own static ISP proxy, opening reliably and staying logged in.
2. **Warmup** — running the activity programme that takes a newly-registered account from cold to ready.

Nothing else. It does not post, does not schedule, and does not talk to any other system.

> **Status:** proxy management and profile launching work. The warmup session runner is specified but not yet built.

## How it works

- **Electron desktop app.** The main process owns Chrome, the proxy pre-flight and all file I/O; the renderer is presentation over IPC. No HTTP server, no queue, no database, no stored credentials.
- **State is YAML on disk**, validated with `zod` at load. One operator, one session at a time, so file-level invariants are reliable without a database.
- **Real Chrome**, launched with `--user-data-dir` and `--proxy-server`. Not Chromium, not a bundled browser.

## Design decisions worth knowing

These are the non-obvious ones. The full reasoning, with citations, is in [`.scratch/account-warmer/`](.scratch/account-warmer/).

**Fail closed, always.** Opening a profile first resolves the egress IP through its proxy and compares it to the IP that verification recorded. If the proxy is dead, or the vendor silently reassigned the IP at renewal, **nothing launches**. A profile with no proxy refuses to open unless you have explicitly opted that profile into using your real IP.

**Vary almost nothing about the fingerprint.** Only what can be set truthfully at launch — window size, timezone, locale, geolocation — because those are process-level and stay coherent down to the request headers. GPU, canvas, fonts and the user agent are left as the real machine's. A partial spoof is *more* identifiable than none (Fp-Scanner, USENIX 2018), and injection-based spoofing is itself detectable.

Notably absent: `--user-agent`. It does not update `navigator.userAgentData` or the `Sec-CH-UA-*` headers, and that desync is the canonical detection.

**WebRTC is handled explicitly.** STUN runs over UDP outside the HTTP stack, so `--proxy-server` does not carry it and the real IP leaks straight past. Profiles launch with `--webrtc-ip-handling-policy=disable_non_proxied_udp`.

**Proxies are verified, not trusted.** Adding one runs four checks — egress IP, geo against what you purchased, ISP-vs-datacenter classification, and a TLS fingerprint comparison (direct vs through the proxy) that detects a decrypting MITM proxy. A proxy that fails is blocked from assignment, not merely flagged. Verification re-runs on demand, because a check that runs once stops being true the moment an IP changes.

**A known limitation, stated plainly.** Every profile on one machine shares one true hardware fingerprint. Meta's Deep Entity Classification treats device as a graph node whose neighbourhood is "users sharing the device", so at the device layer a fleet is visibly one device. That is chosen, not solved — the alternative is a detectably-fake device. **This design does not scale past a few dozen profiles on one machine.**

## Getting started

```bash
npm install
npm run dev
```

Then: **Proxies → Add** a static ISP proxy (`host:port`, IP-whitelist auth) → **Verify** → **Profiles → New profile**, bind it to that proxy → **Open**.

Chrome must be installed. The app looks for it in the standard locations.

## Scripts

| script | what it does |
|---|---|
| `npm run dev` | run in development with hot reload |
| `npm run build` | build main, preload and renderer |
| `npm run typecheck` | typecheck both projects |
| `node scripts/drive.mjs ss name -- text` | drive the built app, screenshot, dump text |
| `node scripts/smoke-profile.mjs` | end-to-end: create a profile and open Chrome |
| `node scripts/smoke-failclosed.mjs` | assert a profile with no proxy refuses to open |

`npm run dev` strips `ELECTRON_RUN_AS_NODE` before launching. If the parent process is itself Electron — the VS Code integrated terminal, for instance — that variable is inherited and makes `electron.exe` run as plain Node, so the app dies with a baffling `Cannot read properties of undefined (reading 'whenReady')`.

## Data

State lives under the app's userData directory, not in the repo:

```
data/
  proxies.yaml                    # the proxy pool
  personas/<slug>/
    persona.yaml
    profiles/<id>/
      profile.yaml                # proxy binding, fingerprint settings
      chrome/                     # the Chrome --user-data-dir
```

**The `chrome/` directory is the account's identity.** It holds the cookies (`datr`, `sb`) that make an account look established — a 2-year browser identity Meta describes as serving "security and site integrity". Losing it cannot be undone by logging in again.

## A note on what this is for

This automates activity on platforms whose terms prohibit it. Scripted liking and following are named violations on every platform involved; the research in `.scratch/` documents exactly which rules and where. The exposure is account loss. Use it on accounts you own and can afford to lose.
