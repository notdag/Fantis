# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Fantasy football players who manage a real league, primarily on Sleeper.
Casual-but-competitive: they follow fantasy content on YouTube, check their
team multiple times a week during the season, and want fast, trustworthy
answers to "who do I start," "where do I rank," and "should I make this
trade" — not a fantasy-industry-analyst tool.

## Product Purpose

Fantis is a fantasy football companion app: a user links their real league
and gets rankings, rosters, standings, and a trade calculator built from
real data, with a paid tier layered on top later. Success is a user coming
back weekly during the season to check rankings and evaluate trades before
making roster decisions.

## Positioning

The trade calculator's value is a documented, transparent formula built
entirely from real third-party inputs — Sleeper's own season-long PPR
projection, blended with live Vegas player-prop lines when available (see
`lib/tradeValue.ts`) — not an opaque hand-tuned "trade value" score. Most
competing tools (including Flock Fantasy, the product's original design
inspiration) show a single number with no visible methodology; Fantis's
math is inspectable and defensible.

## Operating Context

- **Sync**: user enters a Sleeper username → sees their leagues → syncs
  standings and full rosters (public API, read-only, no auth/password).
- **Rankings**: browsed by position and tier, mainly ahead of setting a
  weekly lineup.
- **Trade calculator**: used when evaluating a specific proposed trade,
  weighing season value plus this week's market signal.
- **League view**: team position-strength rankings and player detail cards
  for a linked league.
- **Admin (owner only)**: `/admin`, gated by a shared passphrase, re-tiers
  the curated player list without code edits — not a feature end users see
  or use.
- Used on both desktop and mobile browsers, seasonally (NFL season).

## Capabilities and Constraints

- **Sleeper** integration is live: leagues, rosters, standings, player
  data, ADP, and season projections, called client-side, read-only.
- **ESPN and Yahoo are not yet integrated** — Yahoo needs OAuth, ESPN has
  no official public API; both require a backend and show as "coming soon"
  until then.
- **SharpAPI** (MVP odds) and **SportsGameOdds** (player props) are
  server-proxied only (real API keys, never exposed client-side) — see
  `app/api/mvp-odds` and `app/api/player-props`.
- **No accounts, persistence, or payments yet.** The curated player list is
  a checked-in data file (`lib/players.data.ts`), rebuilt from real Sleeper
  projections via `npm run regen-players`, not user-editable except through
  the passphrase-gated admin tool.
- Never ask a user for a platform password; every league integration must
  stay read-only.
- Target architecture (not yet built): Postgres/Prisma for persistence,
  NextAuth for real accounts, Stripe for the paid tier, and a server-side
  rankings pipeline replacing the current heuristic.

## Brand Commitments

- Name: **Fantis**.
- Visual identity is a durable product decision, not incidental polish: a
  quiet, Linear-inspired look (near-black canvas, one amber accent, hairline
  dividers instead of card panels, Inter throughout) documented in
  `app/globals.css` and `CLAUDE.md` — explicitly not the loud
  broadcast/scoreboard look the product started with.
- Position color coding (QB green, RB blue, WR red/coral, TE amber) is a
  functional convention to preserve, not just a style choice.

## Evidence on Hand

Pre-launch. No real users, testimonials, press, or usage data exist yet —
future work must not invent them.

## Product Principles

1. Every number traces to a real source (Sleeper, SharpAPI,
   SportsGameOdds) or a documented formula — never a fabricated or
   hand-tuned value.
2. League integrations stay read-only; never request or store a platform
   password.
3. The trade verdict must stay explainable — if the formula changes, it
   still has to be built from real projections/market data, not tuned to
   look right.
4. Core features (rankings, rosters, standings, trade calculator) stay
   free; monetization is additive, mirroring the free-vs-paid split of
   Flock Fantasy, the product's design reference.
5. Built for casual-but-competitive, Sleeper-native, YouTube-audience
   players — not fantasy-industry insiders.
