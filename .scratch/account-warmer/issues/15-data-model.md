# 15 — Data model and persistence

Type: grilling
Status: resolved
Blocked by: 11, 13

## Question

What does the app store, and in what shape?

Deliberately late on the map — the entities are obvious but their *fields* are downstream of the schedule model (11) and the health model (13), and guessing them early means rewriting them.

Sharpening points:

- **Entities**: account, profile (the Chrome `--user-data-dir`), proxy, persona, schedule, session, action, health state, platform credential. Decide which of these are genuinely separate — profile-vs-account and persona-vs-account are the two most likely to collapse or split.
- **The action log is the important one.** Everything downstream — rate budgeting, de-correlation checks (12), health inference (13), and the operator surface (16) — reads it. Decide its grain: one row per action, or per session with counts.
- **Where profile directories live on disk**, how they map to rows, and what happens on backup/restore. These are large, mutable, and irreplaceable.
- 🔴 **Argue the stack; do not inherit it.** Ticket 11 established that sessions are operator-triggered locally with **no autonomous scheduler**, which removes the reason `auto-poster` and `dm-engine` carry BullMQ and ioredis. Fastify likewise only earns its place if ticket 16 concludes a web panel is worth building. **The honest starting hypothesis is: Postgres (or even SQLite) plus a session counter and a session log, and nothing else.** Justify every addition beyond that.
- **Session state is the core of the model now**: a per-account-per-platform **session counter**, the script version that produced each run, and a session log. Ticket 11's advisory ("last session 40 minutes ago") reads from this, as does ticket 13's warmed gate.
- **Fields already fixed by ticket 05, not open for redesign**: a per-account **country** (defaults to US, drives timezone/locale/languages/geolocation — so those are derived, not stored independently), and per-profile **assigned IP, `host:port`, ASN, country and classification-check result**. That last group exists specifically so an undocumented IP change at rental renewal surfaces as a failed pre-flight assertion rather than as an unexplained ban weeks later.
- ⛔ **Secrets: none.** Ticket 14 ruled that the app stores no passwords, no TOTP seeds and no recovery notes — the operator keeps them in their own password manager. **There is no secrets table, no encrypted column, no encryption key to manage, and the `auto-poster/src/crypto.ts` reference is void.** Do not reintroduce it.
- **The account record precedes the social account** (ticket 14's onboarding flow): a row exists, with platform/country/niche/persona, *before* the account is registered. So username and profile URL must be nullable, and there needs to be a `registered` transition that makes session 1 available.
- Run `/domain-modeling` on this one — the terminology settled here propagates into the spec's language.

## Answer

### No database — YAML and JSONL on disk

Operator's decision. Justified by the shape of the app: local, single-operator, no scheduler, no server, no secrets, and **no concurrency at all** — one session runs at a time. Files are inspectable, diffable, and back up by copying a directory, which matters because the Chrome profile directories have to be backed up alongside them anyway (ticket 18).

### The three entities, and why none of them collapse

**Persona → Profile → Account.** The middle one exists because the operator chose configurable grouping.

- **Persona** — the avatar identity. Niche (drives follow-target search, ticket 12), country (drives the whole coherence bundle, ticket 05), display name, bio, avatar image. One persona, many accounts.
- **Profile** — a Chrome `--user-data-dir` and the one proxy IP bound to it. **This is the unit ticket 05's "one profile ↔ one identity ↔ one IP" rule applies to.** A persona has one by default holding all its accounts; the operator may split a high-value account into its own profile and IP.
- **Account** — a platform plus a username, living in exactly one profile. Carries its own session counter, health state and script version.

**Invariant: a Threads account must live in the same profile as its persona's Instagram account.** Not configurable — Threads shares Instagram's session (ticket 07). Enforced at load, not left to the operator.

### Layout

```
data/
  proxies.yaml                    # the operator-managed proxy pool — see below
  personas/<slug>/
    persona.yaml                  # niche, country, display name, bio, avatar path
    profiles/<profile-id>/
      profile.yaml                # proxy_id (reference), fingerprint config
      chrome/                     # the Chrome --user-data-dir — never hand-edited
      accounts/facebook.yaml      # username, session counter, health state, script version
      accounts/instagram.yaml
      accounts/threads.yaml
      sessions.jsonl              # append-only session log
  registry/follow-targets.jsonl   # fleet-wide, append-only
scripts/
  facebook.yaml  instagram.yaml  threads.yaml
```

### Proxy is its own entity, not a field on Profile

⚠️ **Revised.** This ticket originally embedded proxy details inside `profile.yaml`. The operator owns proxy management in the app (ticket 16), which means **proxies exist before profiles and independently of them** — you buy a batch, add them, then assign. Embedding them made an owned resource look like a profile attribute.

**`data/proxies.yaml`** is the pool. Per entry: `id` · `host:port` · observed IP · country · ASN · classification-check result · rental expiry · assignment (`profile_id` or unassigned) · last-verified timestamp and outcome.

**Profile references a proxy by `id`.** The one-profile-one-IP invariant becomes a uniqueness rule on assignment: **no proxy may be assigned to two profiles**, enforced at load and at assign time.

Keeping the pool separate also gives the vendor-exit story from ticket 05 somewhere to live — unassigned spares, expiry dates, and verification history are all pool-level facts.

**Nullable at creation**: `username` and profile URL are absent until the operator registers the account in-profile (ticket 14's flow). A `registered` flag is what unlocks session 1.

**Rental expiry lives in `profile.yaml`** because ticket 05 established that renewal is when an IP silently changes; it needs to be visible next to the IP it threatens.

### The follow registry

`registry/follow-targets.jsonl`, append-only, one record per follow: platform, target handle, persona, account, timestamp. **Loaded into an in-memory set at session start; every candidate is checked against it before a follow executes; each successful follow appends.**

⚠️ **Correction to ticket 12.** That ticket said uniqueness would be "a database constraint, not a convention, and violating it is impossible rather than discouraged." **With no database that is no longer true** — uniqueness is now enforced by application code. What makes it reliable is not a constraint but the **single-writer guarantee**: one operator, one session at a time, so there is no interleaving to lose a write. Append-only also makes the whole follow history auditable, which a table of current state would not. The four invariants from ticket 12 are unchanged; only their enforcement mechanism is weaker, and that is recorded rather than papered over.

### What is deliberately absent

- ⛔ **No secrets of any kind** (ticket 14) — no passwords, no TOTP, no encryption, no key management.
- ⛔ **No BullMQ, no Redis** (ticket 11) — nothing runs unattended, so there is no queue to schedule.
- ⛔ **No Postgres, no Docker dependency.**
- **Fastify only if** ticket 16 concludes a web panel earns its cost. Otherwise the app has no HTTP surface at all.

What remains of the house stack: **Node 22+ ESM, TypeScript via `tsx`, `zod` for validating the YAML on load, `pino`, `vitest`.** `zod` matters more than usual here — with files as the schema, load-time validation *is* the schema enforcement.
