# 19 — Purchase and verify the proxy fleet

Type: task (HITL — operator buys; agent verifies)
Status: open
Blocked by: —

## Question

Nothing to decide — ticket 05 settled the product. This is the manual work that unblocks the fingerprint prototype (06), which cannot start without a real IP to test against.

The operator is purchasing directly from their existing Proxy-Seller account.

## Buy this exactly

- **Product: ISP proxies.** Not Mobile, not Mobile Shared, not Residential (rotating), not IPv4 datacenter. The ISP line is the *"static residential IPs allocated directly by internet service providers"* product. ⚠️ **This is the single thing that can go wrong** — ticket 02 found Proxy-Seller's mobile and rotating lines have silent IP substitution and no fail-closed mode, and Mobile Shared is explicitly shared between 2–3 users. The ISP line has none of those problems.
- **Country: United States.** Country is a per-account field in the design and other countries are supported later, but v1 is all-US.
- **Quantity: one IP per account**, never shared between two accounts on any platform. Ticket 05's binding rule is one profile ↔ one IP ↔ one `host:port`, for the life of the account. A small starting batch is fine — warmup is slow and IPs can be added as accounts are onboarded.
- **Protocol: HTTP(S).** SOCKS5 is offered but **Chrome cannot authenticate to SOCKS5 at all** `[DOC]`, so HTTP(S) with IP-whitelist auth is the working combination.
- **Auth: IP whitelist**, whitelisting the operator's machine. Do **not** rely on username/password — Chrome ignores credentials embedded in `--proxy-server` `[DOC]`, so per-profile identity has to come from a distinct `host:port` instead.
- **Rental period: the longest affordable.** Retention across renewal is undocumented, so every renewal is a chance to silently lose an IP. Fewer renewals is strictly better.

## Record on delivery

Per IP, into whatever the operator uses until ticket 15 exists: **`host:port`, the IP itself, country, and the rental expiry date.** Expiry matters because it is when a silent IP change is most likely.

## Verification is the app's job, not a hand-off

⚠️ **Revised.** This ticket originally ended with "hand a `host:port` to the agent and it runs three checks." **The operator owns proxy management in the app** (ticket 16), so those checks are a product feature instead — **Add** a proxy, and the app verifies it: egress IP, geo, classification/ASN, and the TLS-fingerprint comparison that detects a decrypting proxy.

That is the better home for them regardless of who is available to run them: **every check has to re-run on each rental renewal and each re-bind.** A one-time manual check stops being true the moment an IP silently changes.

**So nothing here blocks on anyone else.** The operator buys the proxies, adds them in the app, and the app tells them whether each one is usable.

## Answer

_(pending — operator purchasing)_
