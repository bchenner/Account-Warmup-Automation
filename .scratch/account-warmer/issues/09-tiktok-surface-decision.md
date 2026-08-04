# 09 — TikTok surface decision

Type: grilling
Status: open
Blocked by: 01, 08

## Question

Is TikTok in v1 of the warmer at all — and if so, on which surface?

TikTok is the worst fit of the five for desktop Chrome, and it is the best-documented adversary:

- `webmssdk.js` uses **VM-based obfuscation** — sensitive JS compiled to custom bytecode with a shipped interpreter. It collects screen dimensions, battery status, timezone, language, UA, platform, canvas and WebGL GPU info `[DOC]`.
- The request signature `X-Gnarly` takes MD5 of the query string, body and User-Agent, timestamps, **and a count of intercepted XHR + fetch requests** `[DOC]` — so instrumenting the page is itself an input to the signature.
- `ttwid`, `msToken` and `s_v_web_id` are generated at runtime from canvas/WebGL/audio/font enumeration; `msToken` is server-reissued per request `[DOC]`.
- Beyond JS: TLS fingerprinting, HTTP/2 frame ordering and TCP/IP stack behaviour, with a researcher observing requests dropped "before it even reaches the application layer" **even with correct signatures** `[DOC]`.
- Repeated but contested `[PC]` claims of large reach loss for desktop-web uploads versus the app.

Options to decide between:

1. **Desktop web anyway** — accept the ceiling, keep TikTok warmup read-only and shallow.
2. **Real Android** — moves TikTok to the mobile stack from ticket 08, with the hardware cost that implies.
3. **Defer** — ship v1 with the four Meta/X surfaces, revisit TikTok as a second effort.
4. **Drop** — TikTok accounts are warmed by hand, permanently.

The decision must state which it is and what the operator does about TikTok in the meantime. Note that option 2 is only available if ticket 08 bought a mobile surface.
