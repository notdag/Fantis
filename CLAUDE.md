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
`posChipStyle`). **The trade verdict bar's tilting mechanic is currently
disabled** (2026-08) — it used to sum a hand-entered "value" score per
player, which had no real methodology behind it and has been removed
entirely from the data model. `components/Trade.tsx` still lets you build
both sides and keeps the mint (Side A) / amber (Side B) heading colors, but
shows an honest "verdict disabled" message instead of a fake or frozen bar.
Re-enabling the tilt is gated on a real trade value metric — do not
resurrect it by re-adding an arbitrary score. Don't drift back toward heavy
gradients, condensed uppercase type, or solid-color position badges without
discussion — and don't drift toward a *generic* SaaS look either (no
unexplained purple/indigo accents, keep the position color system and the
verdict bar's mint/amber heading pairing).

Palette (see `app/globals.css` for the full, authoritative token list):
ink `#10131A` · panel `#141821` · line `#262B34` · line-soft `#1C1F27` ·
bone `#EEF0F3` · muted `#939AA6` · dim `#5D6470` ·
amber `#FFB020` (accent) · mint `#37E0B0` (verdict bar Side A only) · red `#FF5D5D`
Position colors: QB `#5FDA9C` (green) · RB `#59B4E8` (blue) · WR `#F0808A` (red/coral) · TE `#F0B876`

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

1. **No trade value metric.** The old hand-entered 0-100 "value" score (no
   documented methodology) has been removed entirely from `lib/players.ts`
   and the `Player` type — this was intentional, not a bug. This is now the
   single most important gap to fill: the Trade calculator's verdict bar is
   disabled until there's a real per-player value (our own model, a
   projections-derived score, etc.) to sum. `posRank` (WR1, RB4, ...) is
   derived from a player's position within the owner's manually-curated tier
   order (see "Admin tooling" below) rather than from the removed value
   field — still not a computed metric, just a friendlier way to hand-curate
   one until a real pipeline exists.
2. **ESPN and Yahoo don't work client-side.** Yahoo needs OAuth; ESPN has no
   official public API. Both require the backend below. Keep them as
   "coming soon" until then.
3. No accounts, no persistence, no payments yet.

## Data sources

- **Sleeper** — public, read-only, no key. Player dump, ADP, weekly projections
  (summed across all 18 weeks for season totals — see `getSeasonProjectionTotals`
  in `lib/sleeper.ts`). Called directly from client components.
- **SharpAPI** (sharpapi.io) — NFL MVP futures odds, shown in the Rankings
  detail panel. Free tier, but real API key (`SHARPAPI_API_KEY`) — this is
  server-side only via `app/api/mvp-odds/route.ts`, the app's first API route.
  Do not call SharpAPI directly from a client component; the key would leak
  into the browser bundle. Any future paid/keyed data source should follow
  this same proxy pattern, not the direct-client-fetch pattern Sleeper uses.
- **SportsGameOdds** (sportsgameodds.com) — NFL player props (passing/
  rushing/receiving yards, passing TDs, INTs, anytime/first TD), shown
  alongside MVP odds in the Rankings detail panel. Free "Amateur" tier, real
  key (`SPORTSGAMEODDS_API_KEY`), same server-side proxy pattern via
  `app/api/player-props/route.ts`. Two things worth knowing if this gets
  touched again: usage is metered **per event returned, not per prop
  line** (confirmed by testing — a 200+ market event still only cost 1
  "entity"), which is why the route fetches a small event window (`limit=20`)
  and caches for 12h rather than minutes — comfortably under the 2.5k/month
  cap. And each stat comes back in full-game *and* half/quarter variants
  with the same statID+player — the route filters to `periodID === "game"`
  only, or you'll get duplicate-looking rows with different odds and no way
  to tell them apart. Receptions is a defined stat in their taxonomy but
  wasn't populated as a live market in testing — don't wire it up assuming
  it's there without checking again.
- All three are read-only informational data. Rankings values are still our
  own starter data — see "Known limitations" below.

## Admin tooling

- **`/admin`** — an owner-only tier board (`components/TierBoard.tsx`) for
  re-tiering and re-ranking the curated player list without hand-editing
  code. Not linked from the main nav; regular visitors get a passphrase
  prompt (`components/AdminLogin.tsx`) and nothing else. This is *not* a
  real accounts system — see "Working rules" — it's a stopgap until NextAuth
  lands per the build order below.
- Access is gated by a single shared passphrase in `ADMIN_PASSPHRASE` (env
  var, never committed), checked server-side in `lib/adminAuth.ts` against
  an httpOnly cookie holding a hash (not the passphrase itself, so it can't
  be forged by setting a cookie manually).
- The curated player list is split: `lib/players.data.ts` holds just the raw
  `[name, pos, team, tier, posRank]` tuples; `lib/players.ts` holds the
  derived logic (`PLAYERS`, `POS_COLOR`, `posChipStyle`, `computePosRanks`).
  Saving from the tier board (`app/api/admin/save-tiers/route.ts`)
  regenerates only `players.data.ts` — recomputing `posRank` from a
  player's position within the new tier order — and dev's Fast Refresh
  picks up the change immediately. In production (read-only filesystem),
  the route can't write the file, so it returns the generated source for
  the owner to paste in and commit instead.

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

- Preserve the design system in `app/globals.css` and the verdict bar's mint/amber
  heading colors. The tilting-bar mechanic itself is disabled pending a real trade
  value metric — see "Known limitations" — don't re-enable it with a fabricated score.
- Keep Sleeper calls read-only; never ask a user for a platform password.
- Isolate each league provider behind one interface (`getLeagues`, `getRosters`,
  `getStandings`) so Sleeper/Yahoo/ESPN are swappable.
- Never hardcode secrets; use env vars. Don't touch payment/auth code without
  flagging the risk first.
- Rankings values are not investment/betting advice — keep that disclaimer in the UI.
- Editing controls for the curated player list (tiers, rank) belong behind the
  `/admin` passphrase gate, never on a page a regular visitor can reach — see
  "Admin tooling". The passphrase check is a deliberate stopgap, not real
  auth; don't extend it to protect anything more sensitive than this.

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
