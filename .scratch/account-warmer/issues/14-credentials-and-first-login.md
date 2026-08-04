# 14 — Credentials, 2FA and first-login handover

Type: grilling
Status: resolved
Blocked by: —

## Question

How does a manually-registered account get adopted into an app-managed profile without the handover itself looking suspicious?

This is the seam between the operator's manual registration (out of scope, by decision) and everything the app does. It is on the frontier because nothing else has to be settled first.

Sharpening points:

- **The handover problem.** The account was registered somewhere — the operator's real browser, a phone, a clean session. Its first appearance in a brand-new Chrome profile behind a brand-new proxy is a device change *and* an IP change at once, on a fresh account. Decide whether we (a) register directly inside the app-created profile from the start, (b) import cookies/session from wherever registration happened, or (c) accept the login as a normal new-device event and let the platform challenge it.
- Option (a) is worth serious weight: it keeps one device and one IP from account creation onward, which the standing research says is where scoring actually happens — "within minutes after creation" `[DOC]`. It does not require automating registration, only performing it inside the profile the app will later drive.
- **Credential storage**: `auto-poster` already has `src/crypto.ts` — match the house pattern rather than inventing one.
- **2FA**: TOTP seeds stored alongside credentials, or the operator handles challenges interactively? Decide who is responsible when a checkpoint appears mid-session.
- **Session longevity**: what the app does when a profile is silently logged out, and how it distinguishes that from a soft ban (ticket 13).
- **Never clear cookies or the profile directory** — `datr` and `sb` are 2-year identity cookies Meta describes as serving "security and site integrity" `[DOC]`; TikTok's `ttwid` is a 1-year anti-fraud identity. Decide the backup strategy for profile directories, since losing one is losing the account's history.

## Answer

### There is no handover, because registration happens inside the profile

**The app creates the profile and binds its proxy first; the operator then registers the account by hand in that window.** One device and one IP from minute zero.

This is the strongest available answer to the ticket's central problem, and it works by deleting the problem rather than managing it. The standing research is unambiguous that accounts are scored *"within minutes after creation"* `[DOC]` and that warmup cannot rescue a bad registration — so there is now no first-login device-change event, no simultaneous device+IP change on a young account, and no partial cookie transplant into a mismatched fingerprint.

**It does not reopen the registration scope call.** The app never scripts signup; the operator types. The app supplies the browser, which is exactly the "account access" feature it already owes.

### The onboarding flow this implies

Ordering matters, because the profile now precedes the account:

1. Operator creates an **account record** — platform, country (default US), niche, persona data. At this point the social account does not yet exist.
2. App **provisions a profile directory and binds a proxy IP** to it.
3. App **opens the profile**, on its proxy, fail-closed.
4. Operator **registers the account by hand** in that window.
5. Operator marks it registered; **session 1 becomes available.**

🔴 **This makes [ticket 19](19-purchase-proxy-fleet.md) a hard prerequisite for onboarding any account at all** — not just for the fingerprint prototype. No IP means no profile means no registration. It is now the first thing on the critical path.

### The app stores no credentials

**No passwords, no TOTP seeds, no recovery notes.** The operator keeps credentials in their own password manager and pastes them on the rare occasions a re-login is needed.

This is coherent with the rest of the design: the app **never logs in during normal operation**, because the session persists and cookies are never cleared. Login is break-glass only, and the operator is present at every session anyway since sessions are manually triggered.

**Consequences:**

- **No encryption, no key management, no encrypted columns, no secrets in the data model.** The `auto-poster/src/crypto.ts` reference in this ticket and in ticket 15 is **void** — that helper is not needed.
- **2FA is entirely operator-handled.** The app detects a challenge and stops (ticket 13's `checkpoint` state); the operator opens the profile and clears it by hand.
- Recovery from `logged_out` is the same shape: the app reports, the operator opens the profile and signs in. Ticket 18 owns the detection and the custody of what must not be lost.

### Residual

⚠️ **Accounts that already exist and are live cannot be registered in-profile.** The operator's current avatar accounts posting through egged are already established and do not need warmup, so this is not a v1 problem — but if one ever needs adopting into the warmer, none of the above applies to it and the adoption path is unspecified. Left as a small fog item rather than forced into a v1 answer.
