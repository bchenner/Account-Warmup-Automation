# 08 — Mobile surface decision

Type: grilling
Status: open
Blocked by: 01, 03

## Question

Do any platforms run on a real mobile surface, and if so which — and does that mean buying devices?

Sharpening points:

- Decide per platform, since the answer will differ: Instagram and TikTok are the app-centric ones; X and Facebook are usable on desktop web; Threads inherits whatever Instagram does.
- **If mobile is in**: real devices or emulator, how many, one account per device or shared? Meta and TikTok both treat device as a graph node whose neighbourhood is the accounts on it — sharing one device across 30 accounts recreates exactly the cluster we're avoiding.
- **If mobile is out**: accept the desktop-web capability ceiling from ticket 01 and record what warmup actions we consequently cannot perform.
- **Scope consequence either way.** Mobile in-scope means a second driver stack (ADB/Appium) alongside Playwright, a second fingerprint model, and physical hardware on the operator's desk — a materially larger spec. Mobile out-of-scope becomes an **Out of scope** line on the map.
- Settled already and not to be reopened: emulating mobile from desktop Chrome is not an option (Picasso canvas explicitly targets it; DevTools emulation doesn't touch the WebGL renderer; `os_mismatch` and JA4 are unreachable from JS).
- Note this ticket blocks 09 — the TikTok answer depends on whether a mobile surface exists to move it to.
