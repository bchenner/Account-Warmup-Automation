# 17 — Boundary with egged / auto-poster

Type: grilling
Status: closed — out of scope
Blocked by: —

> **⛔ Ruled out of scope by the operator**, who scoped the app to two features — account access and warmup — and nothing else. There is no integration with egged or `auto-poster`: no shared database, no API, no status flag the poster reads, no reach data flowing back. An account is marked warmed and the operator takes it from there by hand.
>
> The one point below that survives is now enforced by the map's Destination rather than by this ticket: nothing in the warmer drifts into posting, **including the "first post" that every warmup schedule ends with**. The map stops at ready-to-post.
>
> Not a step on the route, so this stays out of Decisions-so-far. Original question retained below for the record.

## Question

Is this a standalone app or a module of the existing stack — and how does a warmed account reach the poster?

On the frontier: nothing blocks it, and the answer shapes the data model (15) and the operator surface (16), so settling it early is cheap.

Sharpening points:

- **Standalone vs module.** `dm-engine`/egged and `auto-poster` both run Fastify + BullMQ + Postgres and both already know about the operator's social accounts. Decide whether the warmer shares a database with either, talks to them over an API, or is fully independent with a manual handoff.
- **The handoff itself**: what "warmed" means to the poster. A status flag it reads, an event it receives, or the operator moving the account by hand.
- **Account identity across systems** — egged already has account records. Decide whether the warmer references them or keeps its own, and which system is authoritative.
- **The reverse direction**: does the poster tell the warmer anything? Post outcomes and reach are exactly the output signals ticket 13 wants for its gate, and the poster is where they already land.
- **Ownership boundary**: publishing stays with the poster (already an **Out of scope** line). Confirm nothing in the warmer drifts into posting — including the "first post" that every warmup schedule ends with, which is the obvious place for the boundary to blur.
