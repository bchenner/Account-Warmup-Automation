# 04 — Mobile surface feasibility: real Android, emulator, iOS, cloud farms

**Research date:** 2026-08-03
**Answers:** `issues/03-mobile-surface-feasibility.md`
**Feeds:** `issues/08-mobile-surface-decision.md`, `issues/09-tiktok-surface-decision.md`
**Builds on:** `research/01-warmup-protocol.md` — fingerprinting (§ "Fingerprinting: what is actually read"), automation detection, proxy sections. Not repeated here.

Labels as in the standing research: **[DOC]** platform/vendor-documented or peer-reviewed · **[PC]** practitioner consensus, undocumented · **[WEAK]** single, self-interested, or inferred.

**Premise, not re-argued:** emulating mobile from desktop Chrome is dead. DevTools emulation never touches `UNMASKED_RENDERER_WEBGL`; `os_mismatch` and JA4 are unreachable from JS. Chrome's own docs concede the point for the benign case: mobile emulation "is not a perfect replication of testing on the actual device," listing **different GPU capabilities** first among the reasons ([Chrome for Developers — mobile emulation](https://developer.chrome.com/docs/chromedriver/mobile-emulation)) **[DOC]**.

⚠️ **But one leg of that premise needs downgrading.** The Picasso citation in the standing research is weaker than presented — see **§2.1**. The conclusion survives on the other legs; the citation should not be reused as-is.

---

## Verdict

| Path | Achievable? | Detectable? | Persistent state? | Cost at 10–30 accounts |
|---|---|---|---|---|
| **Real Android, ADB/Appium** | **Yes** — the only path that is both technically and economically real on a Windows box | **Yes, at the automation layer.** The device is genuine; the *driver* is not. USB debugging + developer mode is a productised RASP signal, and UiAutomator2 installs three visible packages. Mitigable, never zero. | **Yes** — it's your hardware | **$2.7k (10 devices) – $8k (30 devices) capex + $300–800/mo** at 1 account/device. Roughly a third of the capex at 3 accounts/device via user profiles, but only if you also accept a shared egress IP |
| **Android emulator (AVD/Genymotion/BlueStacks/LDPlayer)** | Technically yes | **Yes.** `GL_RENDERER` is passed through from the host and wrapped as `Android Emulator OpenGL ES Translator (…)`; BlueStacks literally reports `Bluestacks`. Plus QEMU artifacts, frozen sensors, always-Charging battery. **Cannot reach `MEETS_DEVICE_INTEGRITY`.** | Yes (disk image) | Low $ — but the money is wasted |
| **Android container on real ARM (Waydroid / redroid / cloud phone)** | Yes, with effort | **Partially.** Removes the QEMU and x86 tells and gives genuine Mesa strings; still not a shipping phone GPU config, still no hardware-backed integrity verdict | Yes | Server cost; see §4 |
| **iOS, real iPhone + Appium/WDA** | Yes. A Mac-free path exists (iOS 18+ only, "limited support", brand new) but signing is a permanent tax | Less studied than Android. WDA is a visible installed app; Developer Mode required; certs expire annually. Instagram iOS has jailbreak detection | Yes | **$2.6k capex + ~$75–475/mo host** at 20. Worst effort-per-account of any path |
| **iOS Simulator** | **No.** App Store IPAs are a different Mach-O platform *and* FairPlay-encrypted | Moot — ⚠️ but the expected WebGL tell is **refuted**: WebKit hardcodes `"Apple GPU"` everywhere | Moot | Moot |
| **QA cloud device farm (BrowserStack / Sauce / AWS Device Farm public)** | **No** | Moot | **No — documented wipe every session** | Moot |
| **AWS Device Farm private devices** | Technically yes | Obvious AWS egress IP | **Yes** — cleanup is documented default-off | **~$4,000+/mo at 20** — worse than owning phones |
| **Cloud-phone vendors (Geelark, VMOS, Multilogin, Redfinger)** | Vendor-claimed yes | **Unverifiable.** Every fingerprint claim is marketing | Vendor-claimed yes | **~$600–800/mo at 20** |

**One-line answer:** the only mobile path that survives contact with both the detection evidence and the budget is **real, unrooted Android phones you own, driven over ADB from the existing Windows box** — and even that buys less than it costs unless TikTok is the reason you're doing it.

---

## 1. Real Android

### 1.1 What is actually scriptable, and from Windows

Two distinct stacks, both of which run on a Windows host — no Mac required, unlike iOS.

**Native apps → Appium + UiAutomator2.** Appium itself runs on "a macOS, Linux, or Windows operating system" ([Appium requirements](https://appium.io/docs/en/latest/quickstart/requirements/)) **[DOC]**. The UiAutomator2 driver requires the device to have "USB debugging enabled and should be visible as `online` in `adb devices -l` output," and **root is not required** ([appium-uiautomator2-driver README](https://github.com/appium/appium-uiautomator2-driver)) **[DOC]**.

**Chrome-for-Android → ChromeDriver.** ChromeDriver drives real-device Chrome directly: you start the ADB server, enable web debugging, and pass the `androidPackage` capability (`com.android.chrome`, `com.chrome.beta`, or a debuggable WebView app). "As of Chrome version 33, a rooted device is not required" ([ChromeDriver — Android](https://developer.chrome.com/docs/chromedriver/get-started/android)) **[DOC]**. This is the cheap path for X and Facebook if you want them on a mobile surface — but note it puts you back on **CDP**, and every CDP-detection signal in the standing research (§"Automation detection") applies unchanged.

**ADB itself is the gate.** Developer options must be enabled, USB debugging turned on, and the RSA host key accepted on-device: "USB debugging and other adb commands cannot be executed unless you're able to unlock the device and acknowledge the dialog" ([Android — adb](https://developer.android.com/tools/adb)) **[DOC]**. Wireless debugging over Wi-Fi is supported on Android 11+ after a one-time pairing, which removes the USB-hub problem but not the developer-mode problem. `adb shell` runs as the `shell` user, **not root** **[DOC]**.

### 1.2 What the apps can see — the honest accounting

This is where practitioner folklore and evidence diverge, so take the three tiers separately.

**Tier 1 — provably detectable, productised, no argument.**

*Developer mode and ADB-enabled are a shipped RASP check.* Talsec's open-source freeRASP lists among its detections "unsecured device environments (e.g., **Developer Mode, enabled ADB**)" ([freeRASP README](https://github.com/talsec/Free-RASP-Community)) **[DOC]**. `Settings.Global.ADB_ENABLED` and `DEVELOPMENT_SETTINGS_ENABLED` are ordinary readable system settings; there is no privilege barrier. Any app that wants this signal has it for free.

*Play Integrity gives Google's own verdict on the device.* `MEETS_DEVICE_INTEGRITY` means "a genuine and certified Android device… hardware-backed proof that the device bootloader is locked"; an **empty** verdict means "signs of attack (such as API hooking) or system compromise (such as being rooted), or the app is not running on a physical device" ([Play Integrity verdicts](https://developer.android.com/google/play/integrity/verdicts)) **[DOC]**. Google states the assessment "uses hardware-backed security signals that are highly resilient to attacks and circumvention" ([Play Integrity overview](https://developer.android.com/google/play/integrity/overview)) **[DOC]**. Note the free tier is 10,000 requests/day per app **[DOC]** — cheap enough that any app can call it on every login.

*Fingerprint.com sells emulator, root, and cloned-app detection as three distinct Android Smart Signals* — "ensuring the request is coming from a physical device"; "detecting rooted devices"; "Identify if a request is coming from a cloned application. Making multiple clones of an app on the same device can be used to abuse promotions" ([Fingerprint Smart Signals](https://docs.fingerprint.com/docs/smart-signals-overview)) **[DOC]**. The existence of a paid **cloned-app** product is the single most relevant fact in this whole document for the "N accounts per phone" question (§1.4).

**Tier 2 — structurally detectable, unconfirmed in these specific apps.**

UiAutomator2 installs three packages on the device: `io.appium.uiautomator2.server`, `io.appium.uiautomator2.server.test`, and the `io.appium.settings` helper app, which is also used as a mock location provider ([driver README](https://github.com/appium/appium-uiautomator2-driver)) **[DOC]**. Python's `openatx/uiautomator2` similarly deploys "an HTTP service based on UiAutomator" to the device ([README](https://github.com/openatx/uiautomator2)) **[DOC]**.

But Android 11 filtered package visibility means an app "targets Android 11 (API level 30) or higher and queries for information about the other apps that are installed on a device, the system filters this information by default," and blanket enumeration needs `QUERY_ALL_PACKAGES`, whose "use of this permission is subject to approval" on Play ([package visibility](https://developer.android.com/training/package-visibility)) **[DOC]**. So package enumeration is *not* free for Instagram or TikTok — they would need a declared `<queries>` entry naming `io.appium.*` (trivially evaded by renaming) or an approved `QUERY_ALL_PACKAGES`. **[PC]** Assume they have neither, and that this is a weaker signal than folklore suggests.

Separately, `UiAutomation` "uses the accessibility subsystem by default" ([UiAutomation reference](https://developer.android.com/reference/android/app/UiAutomation)) **[DOC]**, which means an app querying `AccessibilityManager.isEnabled()` sees a live accessibility client while automation runs. Whether Instagram or TikTok reads this is **unverified [WEAK]** — I found no reverse-engineering writeup either way.

**Tier 3 — practitioner claims, treat as hypotheses.**

The most cited concrete report is a BlackHatWorld thread on TikTok + Appium, where operators claim that merely having the device attached to Appium/ADB flags the account, because "no normal user has it enabled," and that TikTok uses **dynamic resource IDs regenerated on every app restart**, breaking XPath-based automation ([thread](https://www.blackhatworld.com/seo/tiktok-automation-using-appium-youre-about-to-access-a-tiktok-experience-designed-just-for-you.1742984/)) **[WEAK]**.

⚠️ **The headline symptom in that thread is probably misattributed.** The message "You're about to access a TikTok experience designed just for you," followed by commenting/following being disabled, is **TikTok's under-13 restricted experience**, not an automation ban. TikTok documents that it "uses predictive technology to estimate age ranges" and that when "the estimate doesn't match the date of birth provided at sign-up, a moderator can review the account" ([TikTok Newsroom — age-appropriate experiences](https://newsroom.tiktok.com/an-update-on-our-work-to-provide-teens-with-age-appropriate-experiences)), with under-13 US users "automatically directed to an age-appropriate experience" ([TikTok support](https://support.tiktok.com/en/safety-hc/account-and-user-safety/tiktok-under-13-experience)) **[DOC]**. A brand-new account with no watch history, a scripted birthdate entry and no behavioural signal is exactly the input that age *inference* has nothing to work with. **Do not design around the automation-detection reading of that symptom without your own telemetry.**

**Honest gap:** there is **no public reverse-engineering writeup showing Instagram's or TikTok's Android app checking for UiAutomator, Appium packages, or the Appium server port**. Searches for it return only setup tutorials. This mirrors the standing research's finding that no public corpus exists for Meta's web bot-detection. Treat "the apps detect Appium" as plausible and unproven; treat "the apps detect ADB-enabled" as cheap for them and therefore likely.

### 1.3 Rooted vs unrooted

**Root buys you almost nothing here and costs you the strongest verdict on the device.**

Neither Appium/UiAutomator2 nor ChromeDriver-on-Android requires root **[DOC]** (both cited above). What root would buy is property spoofing (`build.fingerprint`, serial, IMEI) via Magisk modules — i.e. making one phone look like several phones.

What it costs: on Android 13+, `MEETS_DEVICE_INTEGRITY` requires hardware-backed proof of a **locked bootloader** and a certified manufacturer image ([verdicts](https://developer.android.com/google/play/integrity/verdicts)) **[DOC]**. Unlocking the bootloader to root forfeits it. The root-hiding arms race (Magisk Hide → Zygisk → Shamiko → Play Integrity Fix) is real but works at the property/hooking layer; Talsec's own writeup states that "Play Integrity API enforces hardware-backed device verification, making bypassing root detection more difficult without compromising the device's Trusted Execution Environment (TEE)," and that Play Integrity Fix works by "ensuring valid attestation" — i.e. it depends on keybox material, not on defeating the cryptography ([Talsec — challenges in root detection](https://docs.talsec.app/appsec-articles/glossary/root-detection/challenges-in-root-detection-magisk-hide-zygisk-shamiko-play-integrity-fix)) **[DOC]**. That is a treadmill with a Google-controlled revocation lever on the other end.

**Do Instagram and TikTok actually call Play Integrity? Unverified — this is a real gap.** No first-party statement or credible teardown was found. Public discussion of root-hiding is dominated by banking apps, not social apps **[WEAK]**. But: Meta and ByteDance both ship large native integrity SDKs, the API is free at their scale, and the *cost of assuming they do* is only "don't root," which costs you nothing. **Decision: don't root. It is the dominated strategy.**

### 1.4 Device-per-account — the question that decides the budget

The premise from the standing research: Meta's DEC treats **Device** as a graph node whose neighbours are "users sharing the device" ([USENIX Security '21](https://www.usenix.org/conference/usenixsecurity21/presentation/xu-teng)) **[DOC]**; TikTok looks for accounts that "share technical similarities like using the same devices" ([TikTok Newsroom](https://newsroom.tiktok.com/en-eu/how-tiktok-counters-deceptive-behaviour)) **[DOC]**. So the question is: **can one physical phone present as several distinct devices?**

Take the mechanisms in descending order of cleanliness.

**(a) Android multi-user / work profile / private space — genuinely distinct SSAID, and this is documented.**

Android 8.0 changed `ANDROID_ID` scoping in exactly the way that matters: "the value of `ANDROID_ID` is now scoped **per app signing key, as well as per user**. The value of `ANDROID_ID` is unique for each combination of **app-signing key, user, and device**" ([Android 8.0 behaviour changes](https://developer.android.com/about/versions/oreo/android-8.0-changes)) **[DOC]**. So a second Android user sees a genuinely different `ANDROID_ID` for the same app.

The three user-type mechanisms:
- **Secondary users** — "Each user has distinct app data and some unique settings… No user has access to the app data of another user" ([AOSP multi-user](https://source.android.com/docs/devices/admin/multi-user)) **[DOC]**. Max users is an OEM config value (`config_multiuserMaximumUsers`) **[DOC]** — typically 4 on Pixel.
- **Work profile** — "a separate Android user account," with separate storage areas, separate app instances, and separate accounts ([managed profiles](https://developer.android.com/work/managed-profiles)) **[DOC]**. Crucially it runs *alongside* the personal profile rather than requiring a user switch.
- **Private space (Android 15)** — "uses a separate user profile"; apps are "installed as separate copies from any apps in the main space"; when locked "the profile is stopped… apps in the private space are no longer active" ([Android 15 features](https://developer.android.com/about/versions/15/features#private-space)) **[DOC]**.

Appium supports this directly: `appium:userProfile` — "Integer identifier of a user profile. By default the app under test is installed for the currently active user, but in case it is necessary to test how the app performs while being installed for a user profile, which is different from the current one, then this capability may come in handy" ([UiAutomator2 capabilities](https://github.com/appium/appium-uiautomator2-driver)) **[DOC]**.

**What is still shared, and it is a lot.** The AOSP docs are explicit that profiles "share some system-wide settings (for example, Wi-Fi and Bluetooth)" **[DOC]**, and the work-profile docs note "the device itself remains unified" for hardware identifiers **[DOC]**. So across users you share: the hardware serial and IMEI, `Build.FINGERPRINT`, model, screen metrics, GPU, sensor calibration curves, the Wi-Fi/cell egress, and — for anything reading it — the DRM/Widevine device ID lineage. Only the *software-visible per-app* identifiers rotate.

**(b) App cloning / dual apps / parallel space — worse, and explicitly productised against.** App-level virtualization (Parallel Space, VirtualApp-derived clones) runs the guest app inside a host process, so it does *not* get a new Android user and does not get a new SSAID unless the host spoofs it. Fingerprint sells **Cloned App Detection** for Android as a named product ([Smart Signals](https://docs.fingerprint.com/docs/smart-signals-overview)) **[DOC]**. OEM "Dual Apps" (Xiaomi/Samsung) sit in between — they use a profile user, so SSAID does rotate, but the profile user ID is a well-known constant. **Avoid app cloning entirely.**

**(c) The app's own limit.** Instagram's app allows adding roughly **five accounts** to switch between ([multiple concurring secondary sources](https://stackinfluence.com/blog/how-many-instagram-accounts-can-i-have-tips)) **[PC]** — but that is the *worst* mechanism available, because all five share one `ANDROID_ID`, one install, one device graph node, and Instagram itself records the switch. **Never use in-app account switching for managed accounts.** It hands Meta the association for free.

**Verdict on device sharing.** Multi-user/work-profile isolation is the only mechanism with a documented identifier split, and it is real but partial: it rotates the *app-scoped* identifiers and nothing else. A defensible middle position is **2–3 accounts per phone, one per Android user profile, never more**, accepting that a determined device-graph correlation would still cluster them. If the accounts are high-value or the platform is TikTok, go **1:1**.

Two hard operational constraints on sharing:
1. **Only one user is in the foreground.** UI automation drives the foreground user only, so secondary users must be driven *serially* with a full user switch between them (seconds to tens of seconds, and background users get stopped). Work profile is the exception — it runs concurrently with the personal profile, which is why work profile is the best of the three for a 2-account phone.
2. **Per-account IP.** The standing research's non-negotiable "one profile ↔ one IP" collides with "one phone ↔ one egress." Two accounts on one phone on one SIM means two accounts on one IP, which `MINFRAUD_NETWORK_ACTIVITY` / Spur `client.count` price in. Per-profile proxying on Android without root means a per-user VPN app (`VpnService`) or per-app proxy — an extra moving part, and a VPN app is itself visible (Fingerprint sells **VPN Detection** for Android **[DOC]**).

### 1.5 Hardware and cost, bluntly

**Devices.** Don't buy the cheapest thing. Buy something with a long security-update tail, because a device that stops receiving patches drifts into a shrinking, distinctive `Build.FINGERPRINT` population. Pixel 8 and later get "updates for 7 years"; Pixel 6a and Pixel 7 get 5 years ([Google Pixel update policy](https://support.google.com/pixelphone/answer/4457705)) **[DOC]**. Refurbished Pixel 6a prices "start at $166.00" as of August 2026 ([Back Market price guide](https://www.backmarket.com/en/us/price-guide/google-pixel-6a)) **[DOC]** — that model's support ends in 2026, so budget **$180–300/device** for something still in support. There is nothing wrong with mid-range Samsung A-series either; a *diverse* fleet is better than 25 identical Pixels, since identical `Build.FINGERPRINT` across 25 devices is itself a cluster.

**Host and hubs.** DeviceFarmer/STF — the reference open-source implementation of exactly this — recommends **USB 2.0 powered hubs** (it names the Plugable 7-port 60 W hub) and warns that USB 3.0 hubs cause disconnects; its reference builds reach roughly **28 devices per host**, and its docs state "you cannot have more than one provider unit running on the same host, as they would compete over which one gets to control the devices" ([STF](https://github.com/DeviceFarmer/stf), [DEPLOYMENT.md](https://github.com/DeviceFarmer/stf/blob/master/doc/DEPLOYMENT.md)) **[DOC]**. So **one Windows box can host 20–30 phones** — the existing machine is sufficient. Practitioner build guides put charging infrastructure at **$30–80 for a 10+ port switched hub**, ~$200 charging + $150 racking + $100 cooling for a 25-device build, and ~$40/month electricity ([phone-farm setup guide](https://www.shadowphone.io/blog/phone-farm-setup-guide-2026)) **[WEAK — self-interested vendor]**.

**Egress — the real recurring cost, and the one people under-budget.** Two options:
- *SIM per device*: US prepaid plans around **$15–30/device/month** (Mint 4 GB $15, Visible unlimited $25) **[WEAK, same source]**. This gives a genuine, non-proxied, carrier-native mobile IP — the cleanest egress available anywhere in this document — at the cost of no country control and CGNAT sharing.
- *Dedicated 4G/5G proxy port per device over Wi-Fi*: roughly **$20–40/port/month** ([Proxy4G](https://proxy4g.co/pricing/), [TalkAndroid roundup](https://talkandroid.com/521797-the-best-mobile-proxy-providers-of-2026/)) **[WEAK — vendor pricing]**. And re-read Correction 2 in the standing research before assuming mobile IPs are protective.

**Totals.**

| Configuration | Capex | Monthly |
|---|---|---|
| 30 accounts, 1 phone each | 30 × $250 = **$7,500** + ~$500 infra ≈ **$8,000** | 30 × ($25 SIM) + power ≈ **$800** |
| 30 accounts, 3 per phone (10 phones, personal + work + private space) | 10 × $250 = **$2,500** + ~$250 ≈ **$2,750** | 10 × $25 + 30 proxy ports? see below ≈ **$300–1,000** |
| 10 accounts, 1 phone each | 10 × $250 ≈ **$2,700** | ≈ **$300** |

The 3-per-phone column only saves money if you also accept 3 accounts sharing one egress IP. If you insist on one IP per account, you pay per-account proxy fees anyway and the device saving is the only saving.

**The cost nobody budgets: labour.** Every device needs manual first-boot, Google account, developer-mode enable, RSA key accept, app install, manual account creation (the riskiest step — see standing research point 5, "new accounts are scored at creation"), and periodic manual unsticking. STF's own docs put steady-state at roughly **one manual intervention per week** for a farm **[DOC]**. At 30 devices that is a recurring chore, not a one-off.

---

## 2. Android emulators

### 2.1 ⚠️ Correction: Picasso is much weaker evidence than the standing research implies

The standing research cites Picasso as **[DOC]** for "can distinguish between real Android devices and Android emulators." Read the paper and that citation does not hold up. **This does not reopen the settled decision** — the desktop-can't-fake-mobile conclusion rests on WebGL renderer, `os_mismatch` and JA4, which are independent and strong — but the Picasso line should be downgraded wherever it appears.

Bursztein, Malyshev, Pietraszek & Thomas (Google), *Picasso: Lightweight Device Class Fingerprinting for Web Clients*, **SPSM@CCS 2016 — a workshop paper** ([DOI 10.1145/2994459.2994467](https://doi.org/10.1145/2994459.2994467), [author copy](https://elie.net/publication/picasso-lightweight-device-class-fingerprinting-for-web-clients/)) **[DOC]**. What the paper actually says:

- **The validation dataset was collected August 2013.** Browsers in Tables 1–2: Chrome 28–31, "iOS browser", Firefox 23, Safari 6. **Android appears in neither table**; "Firefox on Android" is explicitly dropped as "too few samples to be statistically significant."
- **The famous "52 million clients / 100% accuracy" is a two-week Feb-2015 live run**, and the 100% figure is *pairwise separability of eight coarse {browser, OS} classes*, computed only over clusters of ≥10,000 clients (0.02% of traffic) sharing both a response and a UA. **It is not a per-client verdict and not a false-positive rate.**
- **It is a font-rasterization fingerprint more than a GPU one.** Without a text primitive, uniqueness is 28–32%; with `strokeText()` used at least once, 100% (Table 5).
- **Granularity collapses below family level** — Windows 7 vs 8 separates at 6.6–11.7%; in the live run 56.4% of Windows 8/8.1 clients were conflated.
- **The emulator demonstration is a single iOS proof-of-concept** (§4.1, Fig. 5: "an emulated iOS device and the corresponding real iOS device"). **There is no Android-emulator experiment anywhere in the paper.**
- The paper's own stated limitation: Picasso "cannot prevent an attacker from forwarding device fingerprint challenges to compromised unemulated mobile or desktop systems for solving."

Deployment evidence beyond that 2015 Google run is absent. The only public implementation is Antoine Vastel's [picasso-like-canvas-fingerprinting](https://github.com/antoinevastel/picasso-like-canvas-fingerprinting) (162 stars, ~15 npm downloads/month) **[DOC]**. **Treat "Picasso is watching" as folklore [WEAK].** The underlying *mechanism* — canvas/WebGL raster hashing — is genuinely ubiquitous (the standing research's own Cloudflare-probes-all-eight-categories finding covers it). Cite that instead.

### 2.2 What actually gives an emulator away — and it is not subtle

**🔑 The GPU renderer string is the killer, and it is structural, not a bug.** The emulator's host-side `rcGetGLString()` rewrites only `GL_VERSION` and `GL_EXTENSIONS`; **`GL_RENDERER` and `GL_VENDOR` are passed through from the host verbatim**, then wrapped by the translator as `Android Emulator OpenGL ES Translator (<host renderer>)` ([RenderControl.cpp](https://github.com/andocker/libandroid-emugl/blob/master/host/libs/libOpenglRender/RenderControl.cpp), [GLEScontext.cpp `buildStrings()`](https://github.com/CyFI-Lab-Public/RetroScope/blob/master/sdk/emulator/opengl/host/libs/Translator/GLcommon/GLEScontext.cpp)) **[DOC]**.

Real captured strings **[DOC]**:

| Environment | `GL_RENDERER` |
|---|---|
| AVD, software | `Android Emulator OpenGL ES Translator (ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver-5.0.0))` ([OWASP MASTG demo output](https://github.com/OWASP/mastg/blob/master/demos/android/MASVS-RESILIENCE/MASTG-DEMO-0114/output.txt)) |
| AVD, `-gpu host` | `Android Emulator OpenGL ES Translator (GeForce GT 740/PCIe/SSE2)`, `…(Radeon (TM) RX 480 Graphics)` ([opengles-gpuinfo records](https://github.com/greggman/opengles-gpuinfo)) |
| Windows emulator claiming to be an ASUS ROG Phone II | `ANGLE (NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0)` on `i686` (same DB) |
| BlueStacks | `GL_VENDOR: BlueStacks`, `GL_RENDERER: Bluestacks` (same DB) |
| Real phones | `Adreno (TM) 750`, `Mali-G78 MP14`, `ANGLE (Samsung Xclipse 940) on Vulkan 1.3.264`, `PowerVR Rogue GE8320` |

Three shipping engines hard-code the emulator string as an oracle: Skia sets `GrGLDriver::kAndroidEmulator` ([GrGLUtil.cpp](https://github.com/google/skia/blob/main/src/gpu/ganesh/gl/GrGLUtil.cpp)), WebRender does `starts_with("Android Emulator")` ([gl.rs](https://github.com/mozilla-firefox/firefox/blob/main/gfx/wr/webrender/src/device/gl.rs)), Firefox blocklists it ([GfxInfo.cpp](https://github.com/mozilla-firefox/firefox/blob/main/widget/android/GfxInfo.cpp)) **[DOC]**. OWASP MASTG states it plainly: "Renderer strings that contain `Bluestacks` or `Translator` can indicate emulators" ([MASTG-KNOW-0031](https://github.com/OWASP/mastg/blob/master/knowledge/android/MASVS-RESILIENCE/MASTG-KNOW-0031.md)) **[DOC]**.

And Chrome hands this to any web page unconditionally — `WebGLDebugRendererInfo::Supported()` returns `true` ([Blink source](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webgl/webgl_debug_renderer_info.cc)) **[DOC]**.

**Sensors and battery.** Documented AVD virtual sensors: accelerometer, magnetometer, ambient temperature, magnetic field, proximity, light, pressure, humidity — battery defaults to **status = Charging, health = Good**, cellular to signal = Moderate ([emulator extended controls](https://developer.android.com/studio/run/emulator-extended-controls)) **[DOC]**. No step counter, no heart rate, and motion changes only when a human drags a slider. `DeviceMotionEvent` is available to any Android Chrome page **with no permission prompt** ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent)) **[DOC]** — a held phone emits continuous jitter, an AVD emits a frozen vector **[PC]**. Recall from the standing research that TikTok's `webmssdk.js` already collects **battery status**.

**System properties, files, telephony — real but cosmetic.** AOSP's own definition is one line: `IS_EMULATOR = getString("ro.boot.qemu").equals("1")` — note `ro.boot.qemu`, **not** the folklore `ro.kernel.qemu` ([Build.java](https://github.com/aosp-mirror/platform_frameworks_base/blob/main/core/java/android/os/Build.java)) **[DOC]**. The canonical folklore list, read from source ([framgia EmulatorDetector.java](https://github.com/framgia/android-emulator-detector/blob/master/library/src/main/java/com/framgia/android/emulator/EmulatorDetector.java), [strazzere/anti-emulator](https://github.com/strazzere/anti-emulator)) **[DOC]**: `Build.FINGERPRINT` starting `generic`; `MODEL` containing `google_sdk`/`Emulator`/`Android SDK built for x86`; `MANUFACTURER` containing `Genymotion`; `HARDWARE ∈ {goldfish, vbox86}`; `PRODUCT ∈ {sdk, sdk_x86, vbox86p}`; file stats on `/dev/socket/qemud`, `/dev/qemu_pipe`, `/dev/socket/genyd`, `/dev/socket/baseband_genyd`, `/sys/qemu_trace`, `/system/bin/qemu-props`, `/system/lib/libc_malloc_debug_qemu.so`, `fstab.vbox86`, `init.nox.rc`; `/proc/tty/drivers` and `/proc/cpuinfo` containing `goldfish`; the `10.0.2.15` NAT address ([emulator networking](https://developer.android.com/studio/run/emulator-networking-address)) **[DOC]**; phone numbers `15555215554`–`15555215584`, IMEI `000000000000000`, IMSI `310260000000000`, operator `"android"`.

**Much of that layer is already dead or defeasible**: `getDeviceId()`/`getSubscriberId()` throw on Android 10+ without privileged permission **[DOC]**, `netcfg` is gone, package enumeration is filtered on API 30+ **[DOC]**, and Magisk ships explicit counter-detection — changelog v30.6: "**[Resetprop] Improve implementation to workaround several property modification detections**" ([Magisk changes.md](https://github.com/topjohnwu/Magisk/blob/master/docs/changes.md)) **[DOC]**. The one genuinely structural in-app probe in the open-source corpus is strazzere's native `qemuBkpt()` — fork, install SIGTRAP/SIGBUS handlers, execute `bkpt 255`, time the child; real silicon traps cleanly, QEMU translation does not ([anti.c](https://github.com/strazzere/anti-emulator/blob/master/AntiEmulator/jni/anti.c)) **[DOC]**.

**⚠️ "x86 means emulator" is dead.** Google ships `arm64-v8a` Google Play system images for API 28–36 ([system image manifest](https://dl.google.com/android/repository/sys-img/google_apis_playstore/sys-img2-3.xml)) **[DOC]**. ARM-on-x86 translation is per-process and marked "development and debugging purposes only" ([Android Developers Blog, Mar 2020](https://android-developers.googleblog.com/2020/03/run-arm-apps-on-android-emulator.html)) **[DOC]** — and it *is* detectable by the shim file (see §2.4).

**The only cryptographic boundary is hardware key attestation.** A verifier checks the chain roots in Google's attestation root and that `attestationSecurityLevel ∈ {TrustedEnvironment, StrongBox}`; anything else is software attestation "signed with a key hardcoded in Android source code… the attestation might have been created by an attacker" ([key attestation docs](https://developer.android.com/privacy-and-security/security-key-attestation)) **[DOC]**. **Everything else in this section is userspace-defeasible. That one is not.**

### 2.3 Does GPU passthrough fix it? No — it inverts the problem

| Stack | Isolation | GPU handling | Renderer seen |
|---|---|---|---|
| Android Studio AVD | QEMU ranchu + WHPX/KVM ([acceleration docs](https://developer.android.com/studio/run/emulator-acceleration)) | gfxstream host translation | Translator wrapper around host GPU, or SwiftShader |
| Genymotion Desktop | VirtualBox (Win) / QEMU+KVM (Linux) ([docs](https://docs.genymotion.com/desktop/)) | host GL | Same Translator wrapper |
| **Waydroid** | **LXC on the host kernel — not an emulator** ([Waydroid docs](https://docs.waydro.id/llms-full.txt)) | `gralloc=gbm`, `egl=mesa` if a DRI node exists, else `egl=swiftshader` ([lxc.py](https://github.com/waydroid/waydroid/blob/main/tools/helpers/lxc.py)) | **real host Mesa** (radeonsi/iris/llvmpipe) |
| redroid | Docker containers | `redroid.gpu.mode=host\|guest\|auto`, **default software** ([redroid-doc](https://github.com/remote-android/redroid-doc)) | SwiftShader, or host Mesa |
| BlueStacks / LDPlayer / MEmu / Nox | Windows hypervisor | host GPU | `Bluestacks`, or desktop ANGLE/D3D11 strings |

Google's `-gpu` modes are `auto, host, software, lavapipe, swiftshader, swangle` ([acceleration docs](https://developer.android.com/studio/run/emulator-acceleration)) **[DOC]**.

**The answer to the ticket's core question is yes — passthrough produces exactly the same class of mismatch as desktop-pretending-to-be-mobile.** A desktop discrete GPU under an Android UA is checkable against public renderer→device-class maps: CreepJS derives a GPU brand by regex and flags `hasSusGpu` against a ~600-entry whitelist plus ~400 known capability tuples ([creepjs webgl](https://github.com/abrahamjuliot/creepjs/blob/master/src/webgl/index.ts), [prediction](https://github.com/abrahamjuliot/creepjs/blob/master/src/prediction/index.ts)) **[DOC]**; `pmndrs/detect-gpu` keeps separate mobile and desktop benchmark tables ([repo](https://github.com/pmndrs/detect-gpu)) **[DOC]**; Firefox's `ChooseDeviceReplacement` is itself a curated renderer→device-family table **[DOC]**.

Passthrough also leaks *capabilities*, not just names. One practitioner measured redroid + RTX 3070 Ti exposing "60+ WebGL extensions, desktop profile, should be 43," concluding it was "a worse fingerprint than patched SwiftShader" ([damru research note](https://github.com/akwin1234/damru/blob/main/research/android-virtualization-alternatives.md)) **[WEAK — single self-published source]**.

**Net: SwiftShader says "software rasterizer on a phone." Passthrough says "RTX 4070 on a phone." Both are anomalies.** Waydroid on Linux with a real GPU is the least anomalous configuration available — genuine Mesa strings, real kernel, no QEMU artifacts — and Mesa-on-Android is still not a shipping phone configuration. Note also that Waydroid's Google Play "certification" is a self-service registration of your `android_id` at Google's uncertified-devices portal ([Waydroid docs](https://docs.waydro.id/llms-full.txt)) **[DOC]** — that grants Play Store access, it does **not** produce a certified-device Play Integrity verdict.

### 2.4 Do Instagram and TikTok actually block emulators?

**TikTok computes the booleans in-app — verified by direct source read.** In a decompiled `com.zhiliaoapp.musically` dump, `com.bytedance.common.jato.util.DeviceInfoUtils` implements `isEmulator()` (reads `ro.kernel.qemu`), `isEmulatorTrans2Arm()` (tests for `/system/lib/arm/nb/libc.so`, the ARM-translation shim), and `checkIsRoot()` (scans ~11 `su` paths) ([TiktokSource — DeviceInfoUtils.java](https://github.com/cxxsheng/TiktokSource/blob/master/com/bytedance/common/jato/util/DeviceInfoUtils.java)) **[DOC]**. Two caveats stated honestly: it uses the **legacy** `ro.kernel.qemu` that modern AOSP no longer sets, and `jato` is ByteDance's *performance* library — so this proves TikTok computes the signal, not that it enforces on it **[WEAK inference]**.

TikTok does **not** appear to use Google attestation — zero code-search hits for `play.core.integrity` or `safetynet` in that dump **[DOC, negative evidence from one snapshot]**. It runs its own stack instead: `X-Gorgon`/`X-Khronos`/`X-Ladon`/`X-Argus`/`X-Bogus`/`msToken` from `libmetasec_ml.so` (formerly `libcms.so`, per [Citizen Lab 2021](https://citizenlab.ca/2021/03/tiktok-vs-douyin-security-privacy-analysis/)) **[DOC]**, with `/service/2/device_register/` carrying model/brand/abi/`openudid`/`cdid`/`google_aid` ([TikTokDeviceGenerator](https://github.com/Loukious/TikTokDeviceGenerator)) **[DOC]**. The published `argus.proto` includes `envCode` and `secDeviceToken` ([argus.proto](https://github.com/huaerxiela/douyin-algorithm/blob/master/argus.proto)) **[DOC]** — nobody has published what `envCode` encodes, so "emulator flags ride in X-Argus" is inference **[WEAK]**. The closest hard evidence is a dumped **Douyin iOS** `device_register` body containing `"is_jailbroken" = 0` ([writeup](https://github.com/shenydowa/deviceid-x-gorgon)) **[DOC]**.

**Ban/degradation claims are vendor folklore.** BlueStacks publishes a *compatibility* fix article for "TikTok not opening on BlueStacks 5 Nougat 64-bit" ([support](https://support.bluestacks.com/hc/en-us/articles/4486331384845-Solution-for-TikTok-not-opening-on-BlueStacks-5-Nougat-64-bit-with-Hyper-V-enabled)) **[WEAK]**; scattered Reddit/XDA threads report LDPlayer block messages **[WEAK]**. Every confident "emulator = shadowban" source sells cloud phones or antidetect infrastructure. What *is* documented is only TikTok's prohibition on automation ([ToS](https://www.tiktok.com/legal/page/row/terms-of-service/en)) **[DOC]**.

**⚠️ Instagram: emulator is apparently NOT the axis, and this is the surprise finding.** [GramAddict](https://github.com/GramAddict/bot) — the main open-source UiAutomator2 Instagram bot — **officially recommends MEmu and Android Studio emulators and requires no root**, and attributes bans to behaviour **[DOC]**. If Instagram hard-blocked emulators, that project would not exist. instagrapi's maintainer likewise attributes failures to IP/session hygiene: "one account per stable proxy/IP"; "If you call `.login()` from scratch on every run, Instagram sees repeated fresh logins. That is much more suspicious" ([best practices](https://subzeroid.github.io/instagrapi/usage-guide/best-practices.html)) **[DOC]**. Circumstantially against a Meta integrity gate: Instagram ships on Huawei AppGallery (no GMS at all), and GrapheneOS — which fails `ctsProfileMatch` ([grapheneos.org/usage](https://grapheneos.org/usage)) **[DOC]** — reportedly runs Instagram/Facebook/TikTok fine **[PC]**.

**Play Integrity is unambiguous where it applies.** An empty `deviceRecognitionVerdict` explicitly covers "an emulator that does not pass Google Play integrity checks"; `MEETS_VIRTUAL_INTEGRITY` exists for emulators **but is only emitted for apps distributed to Google Play Games for PC** ([verdicts](https://developer.android.com/google/play/integrity/verdicts), [setup](https://developer.android.com/google/play/integrity/setup)) **[DOC]**. Play-image AVDs are CTS-compliant and release-signed **[DOC]**, which historically cleared SafetyNet's `ctsProfileMatch` — but CTS compliance is not hardware-backed locked-bootloader proof, so they fail `MEETS_DEVICE_INTEGRITY` **[WEAK — practitioner reports only]**.

**Commercial emulator detection is real but thinly evidenced.** Fingerprint documents Android-only `emulator`, `root_apps`, `cloned_app`, `factory_reset_timestamp`, `frida`, `tampering`, `location_spoofing`, `high_activity_device` ([Smart Signals reference](https://docs.fingerprint.com/docs/smart-signals-reference)) **[DOC]** — **publishing no accuracy number**, only a cost disclosure ("To detect emulators, several additional device attributes have to be collected… latency can be anywhere between 300 and 1500ms") and the blanket caveat that "any functionality or security measures relying on client-side logic or data can be bypassed" **[DOC]**. Note the field is `root_apps` — *root app package detection*, a weaker claim than "rooted device detection." SEON documents `is_emulator`, `is_rooted`, `system_integrity`, `bootloader_state`, `is_app_cloned`, `is_click_automator_installed`, `cpu_hash`, `kernel_version` ([Fraud API reference](https://docs.seon.io/api-reference/fraud-api)) **[DOC]** — and their own sample response gives the method away: `"is_emulator": true` next to `"kernel_version": "5.15.94-genymotion-android13-…"`. That is a substring match, not ML.

### 2.5 Verdict on emulators

**Don't.** Not because any single tell is fatal, but because the emulator loses on the two axes that matter most and gains nothing you can't get from a $250 phone:

1. **The GPU renderer string is structurally leaky and web-readable**, and no emulator configuration produces a plausible phone GPU. Passthrough makes it worse, not better.
2. **Play Integrity's hardware-backed verdict cannot be reached from any emulator** you can actually run, and that is the one signal that is not userspace-defeasible.
3. **The cost delta is tiny.** Ten refurbished phones cost roughly what one month of a mid-tier cloud-phone subscription costs, and remove the entire question.

**If you nevertheless want to pilot virtualization cheaply, the ranking is: Waydroid on Linux with a real GPU > redroid on ARM (Graviton/Ampere) > Genymotion PaaS on `c6g` > AVD `-gpu host` > BlueStacks/LDPlayer/Nox (worst — they self-identify in the renderer string).** And note the Instagram finding above: for Instagram specifically, the evidence points at IP and login hygiene as the actual axis, not virtualization. That is worth a pilot before spending on hardware for Instagram alone.

---

## 3. iOS

### 3.1 Is there a path without a Mac? Barely — and it is brand new

**Yes, officially, as of recently — and it is crippled.** Appium's XCUITest driver documents "limited support for Windows and Linux host machines," with these constraints: **real devices only** (simulators are macOS-only), devices must run **iOS 18 or later**, automatic device selection is unavailable, and the standard `xcodebuild`-based WDA startup **cannot be used** ([Appium — non-macOS hosts](https://appium.github.io/appium-xcuitest-driver/latest/guides/non-macos-hosts/)) **[DOC]**. Communication runs over a RemoteXPC tunnel via the `appium-ios-remotexpc` dependency, and you must supply WebDriverAgent yourself via `appium:usePreinstalledWDA` or `appium:webDriverAgentUrl`.

**The catch is code signing.** Appium's [preinstalled-WDA guide](https://appium.github.io/appium-xcuitest-driver/latest/guides/run-preinstalled-wda/) states plainly that "the test bundle should be signed properly for real devices," the provisioning profile must be **trusted on the device**, and on iOS 17+ you must strip the embedded XCTest frameworks so the runner uses the device's local copies **[DOC]**. Installers named: `pymobiledevice3`, `ios-deploy`, [`go-ios`](https://github.com/danielpaulus/go-ios) (advertises "Run XCTests including WebdriverAgent on Linux, Windows and Mac"), and [`tidevice`](https://github.com/alibaba/taobao-iphone-device) — the last of which is **abandoned**, its maintainer having stated iOS 17 support exceeded their capacity **[DOC]**.

Signing itself can be done off-Mac with [zsign](https://github.com/zhlynn/zsign), a cross-platform `codesign` replacement that re-signs `.ipa` and `.app` bundles "without Xcode, without macOS" **[DOC]**. So a genuinely Mac-free pipeline exists: build WDA once → zsign on Linux/Windows → install via go-ios → `usePreinstalledWDA`. **[PC]** The *free* personal-team route does **not** work Mac-free, because personal-team profiles are only issued through Xcode.

**Signing economics are a recurring tax.** A free Apple Account gets 3 test devices per platform, 10 App IDs, and profiles that **expire after 7 days** — weekly rebuild-and-reinstall of WDA on every device ([Apple membership comparison](https://developer.apple.com/support/compare-memberships/)) **[DOC]**. The $99/yr Developer Program removes that, but caps you at **100 devices per product family per membership year**, and "disabling a device does not free a slot"; the list can only be reset at the start of a new membership year ([Apple — devices overview](https://developer.apple.com/help/account/devices/devices-overview/)) **[DOC]**. Certificates expire annually, so you re-sign and redeploy across the whole fleet at least once a year.

**WDA is a visible installed app.** The driver "installs `WebDriverAgentRunner-Runner` (WDA) on the device," and Developer Mode must be enabled (iOS 16+, Settings → Privacy & Security), with "several security restrictions that need to be manually lifted beforehand" ([device setup](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/device-setup/)) **[DOC]**. It appears on the home screen and in the app switcher, and XCUITest drives the foreground UI — screen on, unlocked, **one device drives one account session at a time** **[PC]**.

### 3.2 Is iOS automation detectable?

Less detectable than Android UiAutomator, but not invisible, and no one has published a definitive test.

- **The commonest "am I under test" check does not fire.** XCUITest is out-of-process; the target app is not linked against XCTest and does not receive `XCTestConfigurationFilePath`, which is the env-var check used by [in-process test detectors](https://github.com/MobileNativeFoundation/bluepill) **[PC]**.
- **VoiceOver is not a tell.** [`UIAccessibility.isVoiceOverRunning`](https://developer.apple.com/documentation/uikit/uiaccessibility/isvoiceoverrunning) reports VoiceOver specifically, and XCUITest does not enable it **[DOC]**.
- **The plausible tell is the AX runtime flag.** Apple's private `libAccessibility` exports `Boolean _AXSApplicationAccessibilityEnabled()`, declared in WebKit's [`AccessibilitySupportSPI.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/Platform/spi/Cocoa/AccessibilitySupportSPI.h) **[DOC]**. It is `dlsym`-reachable and it is the mechanism XCUITest uses to read the view hierarchy. **No published writeup confirms XCUITest flips it in the app under test [WEAK]** — treat "iOS automation is undetectable" as unproven, not established.
- **Enumerating WDA is impractical for the app.** `canOpenURL:` requires schemes pre-declared in `LSApplicationQueriesSchemes`, capped at **50 entries for apps linked on/after iOS 15** ([Apple docs](https://developer.apple.com/documentation/uikit/uiapplication/canopenurl(_:))) **[DOC]**, and WDA registers no URL scheme. `LSApplicationWorkspace` enumeration is private and entitlement-gated **[PC]**.
- **Jailbreak detection exists in Instagram.** The [reversionet Instagram SSL-pinning-bypass project](https://github.com/reversionet/Instagram-iOS-SSL-Pinning-Bypass) distributes a patched IPA described as "without SSL Pinning **nor Jailbreak Detection**," which implies both are present in stock builds **[PC]**. This kills "jailbreak + tweak injection" as an alternative to WDA.
- **App Attest is the unverifiable risk.** `DCAppAttestService` generates a key **in the Secure Enclave**, has Apple certify it, and signs server requests; the private key "is automatically stored in the Secure Enclave" where "no process can ever directly read or modify it" ([Apple — establishing your app's integrity](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity)) **[DOC]**. **No public evidence was found that Meta or ByteDance ship it [WEAK]** — but note what it would and would not do: it attests the *app binary and device*, so it does **not** by itself defeat a real iPhone running a stock App Store app driven by XCUITest. It **does** hard-kill any resigned/patched IPA, and anything on Simulator.
- **TikTok's real anchor is device registration, not TLS.** A large public ecosystem reimplements `X-Gorgon`, `X-Khronos`, `X-Argus`, `X-Ladon`, `X-Medusa` **plus device registration** ([ssovit](https://github.com/ssovit/x-gorogn-khronos-argus-ladon), [SyntaxSparkk/TikTok](https://github.com/SyntaxSparkk/TikTok)) **[PC]**. TikTok binds accounts to a signed, server-issued device/install ID at first launch. That is the account-graph anchor on both mobile OSes.

### 3.3 🔑 iOS Simulator — the expected finding is REFUTED, but Simulator is dead anyway

**REFUTED: Simulator Safari does not leak the Mac's GPU string.** In WebKit's [`WebGLRenderingContextBase.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp), `UNMASKED_RENDERER_WEBGL` returns the hardcoded literal **`"Apple GPU"`** and `UNMASKED_VENDOR_WEBGL` returns **`"Apple Inc."`** — unconditionally, with no platform or preference guard **[DOC]**. Simulator Safari, real-iPhone Safari and macOS Safari all report the same two strings. **The "Simulator reports Apple M1 / AMD Radeon" hypothesis in the ticket is wrong for Safari's renderer string.** ⚠️ Note the corollary for the desktop side of the standing research: on **Safari**, the WebGL renderer is *not* the discriminating signal it is on Chrome — Apple masks it by design.

**But the capabilities behind it are pass-through.** In the same `getParameter` switch, `MAX_TEXTURE_SIZE`, `MAX_RENDERBUFFER_SIZE`, `MAX_VIEWPORT_DIMS`, `MAX_FRAGMENT_UNIFORM_VECTORS` and `MAX_VERTEX_UNIFORM_VECTORS` come straight from the driver **[DOC]**. On Simulator those are the host Mac's GPU limits, which will not match an iPhone's, and rasterization output differs. Separately, WebKit injects noise into canvas output for scripts it classifies as fingerprinters (`requiresScriptTrackingPrivacyProtection(ScriptTrackingPrivacyCategory::Canvas)` → `createImageForNoiseInjection()` in [`HTMLCanvasElement.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLCanvasElement.cpp)) **[DOC]**, which adds variance in both directions.

**None of that matters, because Simulator cannot run the apps.** Mach-O binaries carry a platform ID in `LC_BUILD_VERSION`; XNU's [`loader.h`](https://github.com/apple-oss-distributions/xnu/blob/main/EXTERNAL_HEADERS/mach-o/loader.h) defines `PLATFORM_IOS = 2` and `PLATFORM_IOSSIMULATOR = 7` as **distinct platforms**, and an App Store IPA additionally carries `LC_ENCRYPTION_INFO_64` with a non-zero `cryptid` (FairPlay) **[DOC]**. The Instagram/TikTok/Facebook/X IPAs will not load in Simulator, full stop **[PC]**. Apple concedes simulators "don't replicate the performance or features of a physical device" and "some hardware-specific features might not be available" ([running your app on simulated or physical devices](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)) **[DOC]** — one of which is the Secure Enclave, so `DCAppAttestService.isSupported` is false there.

**Verdict: Simulator is eliminated by app installability, not by fingerprinting.**

### 3.4 iOS Safari TLS / JA4 — not where you get caught

FoxIO's own [`ja4plus-mapping.csv`](https://github.com/FoxIO-LLC/ja4/blob/main/ja4plus-mapping.csv) contains exactly two Safari TLS rows — `t13d2014h2_a09f3c656075_14788d8d241b` and `t13i2013h2_a09f3c656075_14788d8d241b` — with the **OS and Device columns empty**; the only Apple-labelled row is a JA4T (TCP) entry labelled **"Mac OSX/iPhone"**, grouping the two together **[DOC]**. So published JA4 does not separate iOS Safari from macOS Safari **[PC]**.

And an iOS Safari ClientHello is trivially reproducible in software: [uTLS](https://github.com/refraction-networking/utls) ships `HelloIOS_11_1` … `HelloIOS_14` and `HelloSafari_16_0`/`HelloSafari_26_3`; [tls-client](https://github.com/bogdanfinn/tls-client) ships `Safari_IOS_15_5` … `Safari_IOS_26_0` plus `Safari_Ipad_15_6`; [curl-impersonate](https://github.com/lwthiker/curl-impersonate) covers Safari on macOS only **[DOC]**. **TLS is not the moat on iOS.** The moat is app-layer device identity.

### 3.5 Cloud Mac / cloud iOS — nobody sells a cheap persistent iPhone

- **AWS EC2 Mac** — Dedicated Hosts only, billed "per second with a **24-hour minimum allocation period** to comply with the Apple macOS Software License Agreement" ([EC2 Mac](https://aws.amazon.com/ec2/instance-types/mac/)) **[DOC]**. us-east-1 on-demand: mac2 (M1) **$0.650/hr**, mac2-m2 $0.878, mac1 (Intel) $1.083 ([AWS pricing feed](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/dedicatedhost-ondemand.json)) **[DOC]** → ~$15.60 minimum per allocation, **~$474/month** for one always-on M1.
- **MacStadium** — M2.S $109/mo, M4.S $149, M2.M $199, M4.M/M2.L $249 ([pricing](https://www.macstadium.com/pricing)) **[DOC]**. **No iOS device hosting.**
- **Scaleway Apple silicon** — M1-M €75/mo, M2-M €115, M4-S €149 ([pricing](https://www.scaleway.com/en/pricing/apple-silicon/)) **[DOC]**. Cheapest credible Mac host.
- **Corellium** — virtualizes iOS/iPadOS including jailbroken variants; now a **Cellebrite** product (`corellium.com/trial` redirects to `cellebrite.com`), publishes **no pricing**, routes to sales ([corellium.com](https://www.corellium.com/)) **[DOC]**. Whether FairPlay-encrypted App Store IPAs run on it is **unconfirmed [WEAK]**. You would be buying an enterprise/government forensics platform to run a social-media farm.
- **Anka/Veertu, Mac-in-Cloud** — macOS virtualization/rental, not iOS device clouds.
- **BrowserStack / Sauce / LambdaTest iOS** — session-scoped and wiped; see §4.

### 3.6 Cost at 10–30 accounts

Used iPhone SE 2020 / X pricing could not be fetched from Swappa or Back Market (403) **[gap]**; budget roughly **$80–200/unit [WEAK]**. Note the hardware constraint the Mac-free path imposes: **iOS 18+ only**, so iPhone 8 and X strand you on a Mac host; SE 2020 or newer is the floor.

**Realistic 20-account iOS build:** ~$2,600 device capex + $99/yr Apple Developer (100 UDID slots/yr) + one host (Scaleway M1 at €75/mo, or a Linux box if all devices are iOS 18+) + 20 proxies/SIMs. **Recurring failure modes: annual certificate rotation across the fleet, Developer Mode toggles, WDA crashes, forced iOS updates breaking `appium-ios-remotexpc`.** One device = one active session, screen on.

On stacking accounts: Instagram's commonly cited **5 accounts per install** could not be verified from the primary source (the help article is CAPTCHA-walled) **[gap]**, and TikTok is worse — its device/install-ID registration means every account on one install shares one signed device identity **[PC]**. **Don't stack.**

**iOS verdict: it buys nothing over Android except cost, fragility, and a Mac dependency you can only partially escape.** Same signal quality, roughly triple the price, plus code-signing expiry as a permanent chore. **Do not do iOS at this scale.**

---

## 4. Cloud device farms

### 4.1 The persistence question, per vendor

A logged-in social account needs the same device identity and the same app state for months. QA farms are architecturally built to destroy exactly that.

**BrowserStack — WIPED, explicitly.** "Every device that you use through the BrowserStack Cloud is brand new. Each test is run on a phone with factory settings. Once your test is complete, every last bit of data is destroyed," and "After every use, we return the used device to its original factory settings" ([BrowserStack security](https://www.browserstack.com/security)) **[DOC]**. Private Devices exist for App Live, but the documented differentiators are mobile data, offline mode and iOS entitlements — **not** state retention ([private devices docs](https://www.browserstack.com/docs/app-live/private-devices)) **[DOC]**. Their ToS §3.3 also prohibits using the service "to provide, or incorporate the Services into, any product or service provided to a third party" ([terms](https://www.browserstack.com/terms)) **[DOC]**.

**Sauce Labs — WIPED.** Their real-device cleaning process, verbatim: "User accounts and data are cleared from the device… History and user data is removed from the default system browser… Network settings are reset… Device settings are reset… Your app is uninstalled… Cached data is deleted" ([Sauce Labs supported devices](https://docs.saucelabs.com/mobile-apps/supported-devices/)) **[DOC]**. The same page notes "we do not perform factory resets" — i.e. the wipe is app/data-level, not a reflash, which is why they warn about malware persisting on public devices. The Private Device Cloud is a dedicated pool but the docs **do not** say cleanup is skipped **[DOC-absence]** — assume wiped. Public pricing is **$199/month annually (or $249 month-to-month) per parallel session** ([pricing](https://saucelabs.com/pricing)) **[DOC]**.

**AWS Device Farm — the one genuine exception, on private devices.** Public fleet: "After test execution completes, we perform a series of cleanup tasks on each device, including uninstallation of your app," with the candid caveat "it is possible for data to persist between sessions in some cases" ([FAQs](https://aws.amazon.com/device-farm/faqs/)) **[DOC]** — a bug, not a feature. But **private devices with an instance profile** document both cleanup behaviours as **off by default**: "Reboot after use — … By default, this check box is cleared (false)" and "Package cleanup — … To keep all the app packages that you installed on the device, leave this check box cleared," plus an explicit "Exclude packages from cleanup" allowlist ([private device account settings](https://docs.aws.amazon.com/devicefarm/latest/developerguide/set-up-private-devices-account-settings.html)) **[DOC]**. A private device is "a physical mobile device that AWS Device Farm deploys on your behalf in an Amazon data center… exclusive to your AWS account," us-west-2 only, and Android units can be requested **rooted** ([working with private devices](https://docs.aws.amazon.com/devicefarm/latest/developerguide/working-with-private-devices.html)) **[DOC]**.

Two things kill it anyway: a hard **150-minute cap** on both remote-access sessions and automated runs ([limits](https://docs.aws.amazon.com/devicefarm/latest/developerguide/limits.html)) **[DOC]**, and the price — **private devices from $200/month each**, $0.17/device-minute PAYG, unmetered slots from $250/month ([pricing](https://aws.amazon.com/device-farm/pricing/)) **[DOC]**. That is **$4,000+/month for 20 devices**, on an obvious AWS IP, versus **~$8,000 once** to own 30 phones outright.

**Genymotion — split.** *SaaS* is lifecycle-managed against you: admins configure "Frontend inactivity" auto-stop when the tab closes, and "Maximum run duration… They will automatically shutdown after the specified duration is reached, whether or not they are active" ([SaaS admin docs](https://docs.genymotion.com/usage/saas/admin_interface/)) **[DOC]**; $0.06/minute or **$219/month per virtual device** unlimited ([pricing](https://www.genymotion.com/pricing/)) **[DOC]**. *PaaS (Genymotion Device Image)* runs in your own AWS/GCP/Azure account, so the disk is yours and persistence is documented via an "External Data disk feature" and disk-image backups ([data backup](https://docs.genymotion.com/usage/paas/data_backup/)) **[DOC]**, at **$0.60/hour per instance plus cloud fees** ≈ $432/month/instance at 24×7 **[DOC]**. Recommended instance types are `c6g`/`m5` — none of which have a GPU ([PaaS docs](https://docs.genymotion.com/paas/)) **[DOC]**, so default rendering is software. The one interesting property is that `c6g` is **ARM64 Graviton**, so there is no x86 translation layer.

**Cloud-phone vendors — the category actually marketed at this use case.** Geelark self-describes as ARM-hosted cloud Android rather than an emulator: "A cloud phone runs on a physical device equipped with an ARM processor, just like a regular smartphone," running "a native Android system without a translation layer," with per-phone "IMEI, MAC address, phone brand, device model, Android ID, system version, CPU model, GPU model" and isolated per-phone storage ([Geelark](https://www.geelark.com/blog/what-is-a-cloud-phone/)) **[WEAK — self-interested]**. Pricing: **$29.9/device/month** unlimited usage, or $0.007/minute PAYG capped at $1.20/device/day, plus **$39.9/month per concurrent "parallel" slot** ([Geelark pricing](https://www.geelark.com/pricing/)) **[DOC-vendor]** — so 20 persistent phones with 5 concurrent ≈ **$800/month**. Proxies are **BYO**, not bundled.

Others in the same category, all **[WEAK]**: [VMOS Cloud](https://www.vmoscloud.com/) (from $4.99/30 days, claims Play Integrity/SafetyNet/Widevine L1 passes), [Redfinger/CloudEmulator](https://cloudemulator.net/), [Multilogin Cloud Phone](https://www.multilogin.com/cloud-phone/) (Android 10–15, 7 device brands, **bundled residential proxies**), [MoreLogin](https://www.morelogin.com/). Enterprise-grade equivalents that are at least architecturally documented: **Huawei Cloud Phone** — "virtual phones virtualized from Huawei Cloud Kunpeng BMSs [that] run native Android," ~$20/phone/month at 72 phones/server ([Huawei CPH](https://www.huaweicloud.com/intl/en-us/product/cph.html)) **[DOC]** — and self-hosted **redroid**, "a GPU accelerated AIC (Android In Cloud) solution" in Docker with arm64 and x86_64 images, persistence via `-v ~/data:/data` and `gpu mode=host|guest` ([redroid docs](https://github.com/remote-android/redroid-doc)) **[DOC]**.

**Nothing any cloud-phone vendor claims about fingerprint uniqueness is independently verifiable.** They do not publish what they spoof, at what layer, or whether all their tenants share a GPU renderer string. Assume the worst until you measure it yourself.

### 4.2 Do the farms look like datacenter IPs? Yes.

Sauce Labs publishes its egress ranges for allowlisting: US-West `66.85.48.0/21`, `162.222.72.0/21`, `34.125.90.96/27`, `44.225.33.89/32`; EU-Central `185.94.24.0/22`, `34.107.82.96/27` ([data centre endpoints](https://docs.saucelabs.com/basics/data-center-endpoints/)) **[DOC]** — the `34.x` blocks are Google Cloud and `44.225.x` is AWS us-west-2 **[PC]**. AWS Device Farm private devices sit "in an Amazon data center" **[DOC]**, so egress is AS16509. MaxMind exposes `is_hosting_provider` and `user_type: hosting`; IPQualityScore returns `connection_type`/`proxy`/`fraud_score`; Spur returns "20+ enrichment attributes… covering geography, ASN, proxy/VPN attribution, device and connection type" ([Spur Context API](https://spur.us/products/context-api/)) **[DOC]**. All three land these ranges in the hosting bucket.

This is precisely why the cloud-phone vendors push BYO proxies and the QA farms don't: QA farms have no reason to hide.

### 4.3 Self-hosted farm

Covered under cost in §1.5. The short version: STF/DeviceFarmer is the reference implementation, root not required, ~28 devices/host, one ADB provider per host so you scale by adding hosts ([STF](https://github.com/DeviceFarmer/stf)) **[DOC]**. Real constraints are power delivery, thermals (screens pinned on cook batteries), and per-device egress.

---

## 5. Mobile IP vs mobile device — separate these

They are not the same lever and they do not substitute for each other.

**What a 4G/5G proxy actually changes: one attribute of one graph node.** In Meta's DEC entity table, **Device** and **IP Address** are *separate* node types, and the direct feature listed for Device is **operating system** while the direct features for IP Address are **country and reputation** ([USENIX Security '21](https://www.usenix.org/conference/usenixsecurity21/presentation/xu-teng)) **[DOC]**. A mobile proxy moves the IP node's ASN class. It does not touch the Device node at all. **"Mobile IP" is not a weaker form of "mobile device"; it is a different axis.**

**Is desktop-device-on-mobile-IP incoherent? No — and that's the point.** Tethering, mobile hotspots and 5G fixed-wireless home internet all put ordinary desktop traffic on carrier ASNs. T-Mobile's home broadband runs on the same AS21928 as its handsets ([ASN lookup](https://ipinfo.io/AS21928)) **[DOC]**. So a Windows Chrome fingerprint arriving from a cellular ASN is **completely ordinary traffic**, seen millions of times a day. There is no `os_mismatch`-style contradiction to fire on.

The consequence cuts both ways:
- **Good news:** the desktop-Chrome-plus-mobile-proxy combination the operation is already planning is *not* self-contradictory. You do not create a new tell by putting a desktop profile behind a mobile IP.
- **Bad news:** it buys you nothing toward "presenting as mobile." The platform reads mobile-ness from the client surface (native app API vs web) and from device signals — UA/Client Hints, `maxTouchPoints`, screen metrics, WebGL renderer, canvas rasterization — none of which the IP touches. Instagram's own mobile-app client identity is built from `phone_id`, `uuid`, `device_id`, `advertising_id`, `client_session_id`, plus `cpu/dpi/model/device/resolution/manufacturer/android_release/android_version` ([instagrapi device settings](https://subzeroid.github.io/instagrapi/usage-guide/interactions.html)) **[DOC-ish, reverse-engineered client]**. A proxy supplies exactly none of that.

**And the mobile IP is not free of downside.** Re-read Correction 2 in the standing research: Cloudflare measured CGNAT IPs as having *lower* bot rates but being "subject to rate limiting three times more often than non-CGNAT IPs" ([Cloudflare, Oct 2025](https://blog.cloudflare.com/detecting-cgn-to-reduce-collateral-damage/)) **[DOC]**. And an anti-bot vendor writing about exactly this attack says the quiet part: "A carrier address can be normal… The case gets stronger when small signals start agreeing: unstable device identity, odd timing, repeated target objects, poor interaction quality, and suspicious account relationships," recommending review of "device identifiers, browser environment, emulator hints, fingerprint stability" when the network layer is ambiguous ([GeeTest](https://www.geetest.com/en/article/mobile-proxies-abuse-detection)) **[DOC — adversary-side vendor]**. **An ambiguous IP shifts weight onto the device, which is strictly worse for a multi-account operator.**

**What each platform actually reads — the practical ranking:**

| Signal | Who reads it | Changed by mobile proxy? | Changed by real phone? |
|---|---|---|---|
| Client surface (native app API vs web endpoint) | All five | No | **Yes** — this is the whole point |
| WebGL `UNMASKED_RENDERER` / canvas rasterization | Meta, TikTok, X (web) | No | **Yes** |
| App-level device IDs (`device_id`/`iid`, `phone_id`, SSAID, GAID) | Instagram, TikTok (app) | No | **Yes** |
| Play Integrity verdict | Any Android app that calls it | No | **Yes** |
| TLS/JA4, HTTP/2 frame order, TCP/IP stack (`os_mismatch`) | Cloudflare/Akamai layer, TikTok edge | No | **Yes** |
| IP country / ASN class / reputation | All five | **Yes** | Only if the phone's egress is chosen |
| IP co-occurrence (`user_count`, `client.count`) | Fraud vendors, likely platforms | Only if per-account | Only if per-device |

**Net:** if you want mobile, buy the device. If you want a clean IP, buy the IP. Buying the IP and calling it mobile is the one move that is definitively not available.

---

## 6. Recommendation for a 10–30 account operation on one Windows box

**Do not build a general mobile stack. Consider a small, TikTok-shaped one, and only if TikTok is in v1.**

**The reasoning, in order:**

1. **Facebook, X and Threads do not need mobile.** They are usable on desktop web, the standing research's fingerprint model already covers them, and adding a second driver stack for them buys nothing.

2. **Instagram is app-centric but survivable on web — and the evidence says virtualization is not the axis Instagram polices.** GramAddict, the main open-source UiAutomator2 Instagram bot, **recommends emulators and requires no root**, and instagrapi's maintainer attributes failures to IP and login hygiene, not device class (§2.4) **[DOC]**. Combine that with the device-graph exposure of a shared phone and a mediocre mobile implementation (3 accounts per phone, shared IP, ADB visible) is plausibly *worse* than a clean desktop profile with a dedicated residential IP. The standing research's own bottom line — "consistency of environment beats slowness of activity" — points at coherence, not at mobile.

3. **TikTok is the only genuine forcing function.** From the standing research: `webmssdk.js` VM obfuscation, `X-Gnarly` signing that counts intercepted XHR/fetch calls, `msToken` reissued server-side per request, plus TLS/HTTP2/TCP-stack filtering that drops requests "before it even reaches the application layer." That is the one surface where "just use desktop web" has a real chance of simply not working. **If TikTok must be in v1, that is what buys the phones — and nothing else does.**

**If you buy hardware, buy this:**

- **6–10 real, unrooted, in-support Android phones** (Pixel 8a / recent Samsung A-series; deliberately mixed models). **$1,800–3,000 capex.**
- **1 account per phone for TikTok. Maximum 2 for Instagram**, split personal profile + work profile (concurrent, documented SSAID split, `appium:userProfile` supported). Never app cloning, never in-app account switching.
- **Wired to the existing Windows box** via a powered USB 2.0 hub, or Android 11+ wireless debugging. Appium + UiAutomator2 for the apps. One host is fine to ~28 devices.
- **Per-device egress**: prepaid SIM per phone if the country is acceptable ($15–30/mo each), else a dedicated mobile proxy port per phone ($20–40/mo).
- **Never root.** It forfeits `MEETS_DEVICE_INTEGRITY` for a spoofing capability you do not need.
- **Total: ~$2,500–3,500 capex + ~$200–400/month + a recurring manual-ops chore.**

**Explicitly do not:**

- **Do not use an emulator.** Every dollar saved buys a detection surface (see §2).
- **Do not touch iOS.** A Mac-free path does exist (paid dev account + zsign + go-ios + `usePreinstalledWDA`, iOS 18+ devices only) but Appium calls it "limited support," it is one iOS release from breaking, and it does not remove the recurring costs: WebDriverAgent installed as a visible app, Developer Mode on, annual certificate rotation across the whole fleet, 100 UDIDs/year. **Same signal quality as Android at roughly triple the price** (see §3). At 10–30 accounts there is no version of this that pays.
- **Do not use QA cloud farms.** BrowserStack and Sauce Labs document destroying your logged-in state after every session, in their own words.
- **Do not use AWS Device Farm private devices.** They persist, but at $4,000+/month for 20 with a 150-minute session ceiling and an AWS egress IP — strictly worse than owning phones.
- **Cloud-phone vendors are the only defensible non-hardware option** (~$600–800/month at 20), and they are a bet on unverifiable vendor claims. If you take that bet, take it as a *pilot on 2–3 throwaway accounts first*, measured, before migrating anything real.

**The staging that actually minimises regret:**

- **v1:** desktop web for Facebook, Instagram, Threads, X. TikTok **deferred**, warmed by hand or not at all. Zero hardware. This is ticket 09 option 3.
- **v1.5:** if and only if TikTok is required, buy **3 phones**, run 3 TikTok accounts 1:1, and measure for 60 days against a hand-warmed control. You are testing one question: *does the app surface actually survive where desktop web didn't?*
- **v2:** scale phones only on that measurement. Mobile becomes a **second driver adapter** behind the same session/schedule/health model — not a second product.

---

## 7. Confidence and gaps

**High confidence (multiple primary sources):**
- Emulator `GL_RENDERER` is host-passthrough wrapped in `Android Emulator OpenGL ES Translator (…)`, read from the emugl source and corroborated by three shipping graphics engines that use it as an oracle.
- Hardware key attestation / `MEETS_DEVICE_INTEGRITY` is the only signal in this whole document that is not userspace-defeasible, and no runnable emulator reaches it.
- TikTok ships its own device-registration and request-signing stack and computes emulator/root booleans in-app.
- ADB/developer-mode is a productised detection signal; emulator, root and cloned-app detection are shipping commercial products.
- `ANDROID_ID` is scoped per app-signing-key **and per user** since Android 8.0 — multi-user genuinely rotates it.
- Play Integrity `MEETS_DEVICE_INTEGRITY` requires a locked bootloader on Android 13+; rooting forfeits it.
- BrowserStack and Sauce Labs wipe device state every session, in their own words. AWS Device Farm private devices do not.
- iOS Simulator cannot run App Store binaries (distinct Mach-O platform ID + FairPlay).
- Mobile IP and mobile device are orthogonal; a desktop fingerprint on a cellular ASN is ordinary traffic, not a contradiction.

**Two things in the standing research and the ticket need correcting, and both matter beyond this document:**

- **Picasso is over-cited.** The standing research labels it **[DOC]** for distinguishing real Android devices from Android emulators. The paper (SPSM@CCS 2016 workshop) has **no Android device in its validation tables at all**, its emulator demonstration is a single iOS proof-of-concept, its discriminative power comes from **font rasterization** rather than GPU, its "100% / 52M" figure is pairwise class separability over ≥10k-client clusters rather than a per-client verdict, and its data is from 2013. **Downgrade to [WEAK] wherever it appears and cite the Cloudflare eight-category probing result instead.** The desktop-can't-fake-mobile conclusion is unaffected — it rests on WebGL renderer, `os_mismatch` and JA4.

- The ticket expected iOS Simulator to leak **Mac-derived WebGL/GPU strings**. It does not. WebKit hardcodes `UNMASKED_RENDERER_WEBGL = "Apple GPU"` and `UNMASKED_VENDOR_WEBGL = "Apple Inc."` with no platform guard, so Simulator, real iPhone and macOS Safari are identical on that field ([WebKit source](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/canvas/WebGLRenderingContextBase.cpp)) **[DOC]**. Simulator is eliminated for a different reason entirely. **Corollary for the standing research's fingerprint model: on Safari, WebGL renderer is a masked constant, not the high-entropy discriminator it is on Chrome. The Safari row of the coherence model needs different signals (capability limits, canvas noise injection, `MAX_TEXTURE_SIZE`).**

**Real gaps — state these as unknown, do not paper over them:**

1. **Whether Instagram or TikTok check for Appium/UiAutomator specifically is unverified**, and the Play Integrity picture is partial. A decompiled TikTok dump shows **zero** hits for `play.core.integrity` or `safetynet` — negative evidence from a single snapshot, so weak, but it points away from Google attestation and toward ByteDance's own `libmetasec_ml.so` stack. **No teardown of Meta's Android integrity checks was found at all**, mirroring the standing research's finding that no public corpus exists for Meta's web bot detection. The recommendation ("don't root, minimise visible automation surface") is robust either way, which is why it is safe to act on the gap.

2. **The single most-cited practitioner report of "TikTok detects Appium" is probably misattributed** to TikTok's under-13 age-inference gate. Nobody has published a controlled test.

3. **No independent measurement exists of any cloud-phone vendor's fingerprint uniqueness.** Every claim in §4 from Geelark, VMOS, Multilogin and Redfinger is marketing text.

4. **No first-party statement from any platform about emulators, and the evidence is genuinely mixed.** TikTok demonstrably *computes* emulator/root booleans (source-verified) but there is no proof it *enforces* on them — the class containing those checks is a performance library. Instagram appears not to police virtualization at all (GramAddict recommends emulators). Every confident "emulators get shadowbanned" claim traces to a vendor selling cloud phones. **Nobody has published a controlled experiment.**

5. **Fingerprint publishes no accuracy figure for Android emulator detection**, and SEON's own sample response shows their method is a kernel-version substring match. The commercial emulator-detection market is real but the technical claims are thin.

6. **Whether Play-image AVDs actually fail `MEETS_DEVICE_INTEGRITY` is practitioner-reported, not tested here.** CTS-compliant release-signed images historically cleared SafetyNet's `ctsProfileMatch`; whether the Android 13+ hardware-backed check rejects them is inference from the doc wording.

5. **The device-sharing threshold is a judgement call, not a measurement.** DEC and TikTok both name device-sharing as a signal; neither publishes a threshold. "2–3 per phone via user profiles" is a defensible position, not an evidenced safe limit.

6. **Sauce Labs private devices** — whether their wipe process is skipped is undocumented either way.

**Test-it-yourself list, cheapest first — every one of these is a day's work and worth more than any citation in this file:**

1. Open [browserleaks.com/webgl](https://browserleaks.com/webgl) and [CreepJS](https://abrahamjuliot.github.io/creepjs/) in Chrome on each candidate surface (real phone, AVD `-gpu host`, AVD software, Waydroid, cloud phone) and **diff the `UNMASKED_RENDERER_WEBGL` strings**. If it contains `Translator`, `SwiftShader`, `Bluestacks`, or a desktop GPU name, that surface is dead.
2. Call the Play Integrity API from a throwaway app on each candidate device and record the `deviceRecognitionVerdict`. Anything that isn't `MEETS_DEVICE_INTEGRITY` is a device you should not trust with an account you care about.
3. Read `Settings.Global.ADB_ENABLED` from a trivial app to confirm the signal is visible with debugging on — then decide whether wireless debugging toggled *off* between sessions is worth the operational cost.
4. Log `DeviceMotionEvent` for 60 seconds on a real phone in a pocket vs the candidate surface. Frozen vector = dead giveaway.
5. **A/B two matched TikTok accounts** — one hand-driven, one Appium-driven, same device model, same IP class — for 60 days, before spending four figures. This is the only experiment that answers the actual question.
