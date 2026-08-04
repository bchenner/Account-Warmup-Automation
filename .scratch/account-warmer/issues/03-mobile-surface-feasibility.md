# 03 — Mobile surface feasibility: real Android, emulator, or iOS

Type: research
Status: resolved
Blocked by: —

## Question

If we want accounts to present as mobile, what is actually achievable — and what is detectable — across real Android devices, Android emulators, and iOS?

Raised by the operator during charting. The standing research already establishes that **faking mobile from desktop Chrome is not viable**: Picasso canvas fingerprinting is explicitly designed to "detect desktop devices pretending to be iPhones", DevTools device emulation does not touch `UNMASKED_RENDERER_WEBGL`, and neither `os_mismatch` (TCP/IP stack vs claimed OS) nor JA4 TLS is reachable from JS. Treat that as settled; this ticket investigates the real-device paths instead.

Sharpening points:

- **Real Android**: what does driving Chrome-for-Android or the native apps via ADB/Appium actually cost and require at 10–30 accounts? One device per account, or can profiles be swapped safely on one device given that Meta and TikTok both treat device as a graph node with "users sharing the device" as its neighbourhood?
- **Android emulators** (AVD, Genymotion, Waydroid): the standing research notes Picasso claims to distinguish "real Android devices and Android emulators" — find how strong that claim is and whether hardware-accelerated emulators with real GPU passthrough change it.
- **iOS**: is there any path that does not require Mac hardware + WebDriverAgent per device? Confirm whether iOS Simulator produces Mac-derived canvas/WebGL (expected: yes, which would rule it out).
- **Cloud device farms** (BrowserStack, AWS Device Farm, Genymotion Cloud) — are any usable for persistent logged-in sessions, or are they wiped per session? Persistent state is mandatory here.
- Separate the **mobile IP** question (4G/5G proxies) from the **mobile device** question and say plainly which of the two each platform actually reads.

Write findings to `research/04-mobile-surface-feasibility.md`.

## Answer

Full findings: [research/04-mobile-surface-feasibility.md](../research/04-mobile-surface-feasibility.md) — 432 lines.

**Recommendation: mobile is not worth it at this scale.** v1 runs desktop web for Facebook, Instagram, Threads and X, TikTok deferred, **zero hardware bought**. If TikTok later proves necessary, buy 3 phones and A/B for 60 days before scaling.

**Real Android is the only viable mobile path** if one is ever taken. Appium/UiAutomator2 and ChromeDriver both run on Windows, neither needs root, and STF's own reference build fits ~28 phones per host. No Mac required.

- **The device is genuine; the driver is not.** Developer-mode-plus-ADB is a shipped RASP check — freeRASP names it verbatim. UiAutomator2 installs three visible packages, though Android 11 package-visibility filtering makes enumerating them non-free for the apps.
- **Don't root.** It forfeits `MEETS_DEVICE_INTEGRITY` (hardware-backed locked-bootloader proof on Android 13+) to buy spoofing that isn't needed.
- **N accounts per phone is partially real.** `ANDROID_ID` has been scoped per app-signing-key *and per user* since Android 8.0, so work profile / private space genuinely rotate it — but serial, IMEI, `Build.FINGERPRINT`, GPU and egress IP are all still shared. **2–3 accounts max, 1:1 for TikTok. Never app cloning, never in-app account switching.**

**Emulators lose on two axes.** `GL_RENDERER` is host passthrough wrapped as `Android Emulator OpenGL ES Translator (…)`; BlueStacks literally reports `Bluestacks`. GPU passthrough doesn't fix it — it trades "software rasterizer on a phone" for "RTX 4070 on a phone".

**iOS**: a Mac-free path now exists (iOS 18+, "limited support", zsign + go-ios) but costs roughly triple for the same signal quality. Simulator is dead for a reason the ticket got wrong — see corrections.

**QA device farms are eliminated by their own documentation.** BrowserStack: *"every last bit of data is destroyed"*. Sauce Labs wipes every session. Only AWS Device Farm private devices persist — $4,000+/month for 20, with a 150-minute session cap. Persistent logged-in state is mandatory here, so this whole category is out.

**Mobile IP ≠ mobile device.** Desktop traffic on a cellular ASN is ordinary — T-Mobile FWA shares AS21928 with handsets — so the combination is *not* incoherent. But it buys nothing toward looking mobile.

### ⚠️ Two corrections to the standing research

1. **Picasso is over-cited — downgrade `[DOC]` → `[WEAK]`.** The paper (SPSM@CCS 2016, a *workshop* paper, data from 2013) has **no Android device in its validation tables at all**; its emulator demonstration is a single iOS proof-of-concept; its discriminative power comes from **font rasterization**, not GPU; and its "100% / 52M" figure is pairwise class separability over ≥10k-client clusters, not a per-client verdict. The paper's own stated limitation concedes it "cannot prevent an attacker from forwarding device fingerprint challenges to compromised unemulated mobile or desktop systems for solving." Deployment evidence beyond one 2015 Google run is absent. **Cite the Cloudflare eight-category probing result instead.** The desktop-can't-fake-mobile conclusion is unaffected — it rests independently on WebGL renderer, `os_mismatch` and JA4.

2. **WebKit hardcodes `UNMASKED_RENDERER_WEBGL = "Apple GPU"` and `UNMASKED_VENDOR_WEBGL = "Apple Inc."` unconditionally**, with no platform or preference guard ([WebKit source](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp)) `[DOC]`. Simulator Safari, real-iPhone Safari and macOS Safari are identical on that field — so the ticket's "Simulator leaks the Mac's GPU" hypothesis is **refuted**, and Simulator is eliminated for an unrelated reason (App Store IPAs are a different Mach-O platform *and* FairPlay-encrypted). **Corollary for ticket 06: on Safari the WebGL renderer is a masked constant, not the high-entropy discriminator it is on Chrome.** A Safari row in the coherence model needs different signals — capability limits, canvas noise injection, `MAX_TEXTURE_SIZE`.

