# CLAUDE.md — Fantis (fantasy football platform)

Persistent project context. This is the source of truth for what we're building
and the decisions already made. Read before starting work.

## Product

Fantis is a fantasy football companion app (inspired by flockfantasy.com). A user
links their real league and gets **rankings, rosters, standings, and a trade
calculator**, with a paid tier layered on top later. Audience: fantasy players,
mostly on Sleeper, YouTube-native, casual-but-competitive.

**Design identity — keep this.** As of 2026-08, the app moved from the
original broadcast/scoreboard look to a quieter, Linear-inspired direction —
this supersedes the scoreboard description below and in `fantis-mvp.jsx`
(which is now stale as a *visual* reference; its Sleeper API logic is still
accurate and worth reading). `app/globals.css` is the authoritative token
source.

Quiet neutrals, one accent (**amber**), no dedicated condensed display face —
just Inter throughout. Canvas is a lifted near-black with a cool blue-grey
undertone (`#10131A`), not true black, which read as flat. Tabular data
(standings, rankings, roster lists) uses hairline row dividers instead of
boxed card panels. Normal case everywhere except tiny uppercase
letter-spaced column-header labels. Position (QB/RB/WR/TE) gets a soft
`color-mix()` chip — tinted background + colored text — not a solid fill, so
it stays scannable without going loud (see `lib/players.ts`'s
`posChipStyle`). **The one deliberate holdover from the old scoreboard
identity is the trade verdict bar**: it keeps its mint (Side A) vs. amber
(Side B) duality and tilts toward the winning side — see
`components/Trade.tsx`. Don't drift back toward heavy gradients, condensed
uppercase type, or solid-color position badges without discussion — and
don't drift toward a *generic* SaaS look either (no unexplained purple/indigo
accents, keep the position color system and the verdict bar's semantic
mint/amber pairing).

Palette (see `app/globals.css` for the full, authoritative token list):
ink `#10131A` · panel `#141821` · line `#262B34` · line-soft `#1C1F27` ·
bone `#EEF0F3` · muted `#939AA6` · dim `#5D6470` ·
amber `#FFB020` (accent) · mint `#37E0B0` (verdict bar Side A only) · red `#FF5D5D`
Position colors: QB `#F0808A` · RB `#5FDA9C` · WR `#59B4E8` · TE `#F0B876`

## Current state

A working single-file React prototype exists: `fantis-mvp.jsx`. It has:
- **Sleeper sync** (public API, no auth, client-side): username → leagues →
  standings + full rosters. Player names resolved from Sleeper's `/players/nfl`
  dump, cached for the day.
- **Rankings** table (position filter, tiers).
- **Trade calculator** with the tilting verdict bar.

Port this prototype's UI and logic into the real app. It's the design reference,
not the final architecture.

## Known limitations to fix (this is the real work)

1. **Rankings/values are hand-entered placeholder data** (the `PLAYERS` array in
   the prototype, ~120 players). This is the single most important thing to
   replace with a real source: our own rankings, a projections feed, or a model.
   The code is done; the *data* is what makes the product valuable.
2. **ESPN and Yahoo don't work client-side.** Yahoo needs OAuth; ESPN has no
   official public API. Both require the backend below. Keep them as
   "coming soon" until then.
3. No accounts, no persistence, no payments yet.

## Target architecture

- **Next.js (App Router) + TypeScript** — single app, API routes for the backend.
- **Postgres** (via Prisma) — users, linked leagues, cached player/ranking data.
- **Auth** — NextAuth (or Clerk). Needed before Yahoo OAuth and payments.
- **Payments** — Stripe (subscription tier: premium rankings, trade analyzer,
  full league insights). Mirror the free-vs-paid split flockfantasy.com uses.
- **League integrations** — Sleeper (done, read-only public API) · Yahoo
  (OAuth, server-side) · ESPN (unofficial, server-side, expect breakage).
- **Rankings pipeline** — a server job that ingests/computes values and stores
  them, so the client reads from our DB, not a hardcoded array.

## Working rules

- Preserve the design system in `app/globals.css` and the verdict bar's mint/amber duality exactly.
- Keep Sleeper calls read-only; never ask a user for a platform password.
- Isolate each league provider behind one interface (`getLeagues`, `getRosters`,
  `getStandings`) so Sleeper/Yahoo/ESPN are swappable.
- Never hardcode secrets; use env vars. Don't touch payment/auth code without
  flagging the risk first.
- Rankings values are not investment/betting advice — keep that disclaimer in the UI.

## Suggested build order

1. Scaffold Next.js + TS, port the prototype UI into components, keep Sleeper working.
2. Add Postgres + Prisma; move the rankings data out of the array into the DB.
3. Add auth; persist a user's linked leagues.
4. Add Yahoo OAuth behind the provider interface.
5. Add Stripe subscription + gate premium features.
6. Build the real rankings/projections pipeline (replaces placeholder values).

## Commands

_(fill in once scaffolded, e.g.)_
- Dev: `npm run dev`
- Build: `npm run build`
- DB: `npx prisma migrate dev`
