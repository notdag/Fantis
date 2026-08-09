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
`posChipStyle`). **The trade verdict bar's tilting mechanic is re-enabled**
(2026-08) — see "Trade value methodology" below for what it sums now. The
old hand-entered 0-100 "value" score it originally used had no documented
methodology and was removed entirely; the replacement is a real, documented
calculation, not a resurrection of that field. Don't drift back toward heavy
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

1. **Trade value is a heuristic, not a "real" projections pipeline.** See
   "Trade value methodology" below — it's built entirely from real inputs
   (Sleeper's own season projection, live Vegas props) with no invented
   numbers, but it's still a first-pass formula, not the server-side
   rankings pipeline described in "Target architecture". `posRank` (WR1,
   RB4, ...) is a separate thing — derived from a player's position within
   the owner's manually-curated tier order (see "Admin tooling" below), not
   from trade value.
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

## Trade value methodology

The Trade calculator's verdict bar (`components/Trade.tsx`) sums a real,
documented per-player value — see `lib/tradeValue.ts` for the full writeup
in code. Short version:

1. **Base value = Sleeper's season-long PPR point projection** (the same
   number shown as "Szn Pts" in Rankings) — a real third-party projection,
   not something Fantis invented.
2. **If the player has live props this week** (via SportsGameOdds), convert
   those prop lines into an expected-points total for that one week using
   standard full-PPR scoring (0.04 pts/passing yd, 0.1 pts/rush-or-rec yd,
   4 pts/passing TD, 6 pts/rush-or-rec TD, -2 pts/INT thrown — the same
   scale Sleeper's own `pts_ppr` implies). Yardage props use the O/U line
   directly as the expected value; the anytime-TD prop uses de-vigged
   implied probability × 6. "First TD" is excluded to avoid double-counting
   with "Anytime TD".
3. Compare that weekly-expected number to the player's own season pace
   (season pts ÷ weeks with a projection) to get a delta — is the market
   expecting more or less than this player's average week?
4. Add that delta to the season value once (not multiplied), capped at
   ±20% of weekly pace so one thin/mispriced market can't swing a season
   value. The cap is a documented safety bound, not a tuned parameter.
5. No props this week (most players, most weeks) → value is just the season
   projection, unmodified.

Known gap: SportsGameOdds doesn't currently offer a receptions prop (see
"Data sources" above), so the weekly market side of the blend is missing
that point value even though the season baseline (full PPR, via Sleeper)
includes it — this means the weekly delta slightly understates pass-catchers
relative to the season baseline. Documented, not silently wrong.

`lib/useTradeValues.ts` computes this for every curated player once per page
load; `lib/playerIdMap.ts` holds the shared Sleeper-id matching (also used
by Rankings) that both this and the live projections depend on.

## Advanced stats (2026-08)

Real, derived stats added after reviewing a third-party draft guide for
ideas — the guide's actual rankings/analysis weren't used (both a
copyright concern and off-brand: Fantis's pitch is inspectable math, not
another analyst's opinions), but a few of its stat *concepts* were
reimplemented from scratch against Fantis's own data:

- **Adjusted PPG** (player card, General tab) — average real PPR points
  per game, counting only games where the player's snap share was at
  least half their own season median. This stands in for a human
  analyst's "in complete games" / "as starter" judgment calls with an
  objective, reproducible rule instead — self-calibrated per player so a
  committee RB and a bellcow WR aren't held to the same snap floor.
  Requires 3+ qualifying games or shows "—". See `lib/seasonProfile.ts`.
- **Reception-point share** (player card, General tab) — what % of a
  player's real season points came from receptions (catches + receiving
  yards + receiving TDs) vs. everything else, using the same full-PPR
  scale as trade value. Also `lib/seasonProfile.ts`.
- **Scoring Environment** (Rankings detail panel) — a team's own implied
  point total for the week (O/U ± spread, split in half), derived from
  the same real ESPN scoreboard odds `lib/espnGames.ts` already fetches
  for game context — no new request, no new data source. See
  `impliedTeamTotal()`.
- **RZ Opp/Gm** (player card, General tab + Logs table) — real red-zone
  opportunity per game: pass attempts inside the 20 for QBs, rush
  attempts + red-zone targets for RBs, red-zone targets for WR/TE.
  Sourced from fields Sleeper's `/stats` endpoint already returns
  (`pass_rz_att`, `rush_rz_att`, `rec_rz_tgt`) but the app wasn't parsing
  yet — turns out that endpoint carries ~235 fields total, far more than
  `WeeklyStatLine` used before this. `g2g_att`/`g2g_conv` (goal-to-go)
  looked promising from the same field list but turned out to be a
  **team**-level stat (keyed `TEAM_BUF` etc.), not per-player — checked
  directly against the raw payload before shipping and left out, same
  category of trap as the SportsGameOdds receptions prop above.

All four of these run on real box-score data from `getPlayerGameLog()`
(`lib/sleeper.ts`), the same source the player card's Logs tab already
used — no new API calls for any of them.

Deliberately not pursued: target share via routes run, air yards over
expected, YAC over expected, broken-tackle/elusiveness rate. Sleeper's
`/stats` payload does carry some raw counting fields in this territory
(`rec_air_yd`, `rush_yac`, `rush_btkl`) but turning those into the
guide's efficiency-style *rate* stats needs a routes-run or attempts
denominator Sleeper doesn't expose — a real future addition, not ruled
out, just not done yet. OL grades, playcaller history, and the "Luck
Metric" need PFF-style charting or box-score event data (penalties,
busted coverage, etc.) no free source provides — that's the one category
that'd need an actual new data integration, a bigger call than a stat
tweak.

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
- **`npm run regen-players`** (`scripts/regenPlayers.ts`) — rebuilds the
  whole curated list from real Sleeper data instead of hand-picking
  players: top 80 RB/WR and top 40 QB/TE by real season PPR point
  projection (position caps aren't uniform — checked directly against
  Sleeper's data that QB/TE point projections cliff off much faster than
  RB/WR's do), tiered by quantile within each position's own pool. This
  is what the curated list was built from (2026-08); it replaced an
  earlier hand-typed list that kept missing real rostered players (a
  recurring problem — see git history). Re-run it when the pool feels
  stale (new season, a rookie class landing on rosters, a wave of trades)
  instead of hand-adding players one at a time. It's a full overwrite, not
  a merge — it discards any manual tier moves made via `/admin` since the
  last regen, so re-tier from the fresh baseline afterward if needed.
- **`npm run add-missing-players`** (`scripts/addMissingPlayers.ts`) —
  the safe alternative to a full regen: finds real players inside a
  top-300-by-real-ADP pool (roughly a real 12-team mock draft's depth)
  who aren't in the curated list yet, and appends them at tier G without
  touching anything already curated — existing tiers/order from manual
  `/admin` edits are untouched. Deliberately ADP-based rather than
  points-based like `regen-players`' core selection, since "who actually
  gets drafted" is what a top-up should mean.
  Known wrinkle: Sleeper's ADP blends every league format on their
  platform (deep bench, TE-premium, dynasty), so a naive top-300 skews
  TE-heavy — the first run pulled in 68 TEs, most with no real
  single-TE-league relevance (backups like Joe Royer, Marlin Klein).
  Fixed with a `MAX_TOTAL` cap (TE: 30) on top of the shared 300-player
  pool; QB/RB/WR didn't show the same skew so they stay uncapped. Run
  after someone reports a missing real player, or periodically to keep
  search/trade-calculator coverage broad.

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
  heading colors. The tilting-bar mechanic sums the real trade value described in
  "Trade value methodology" — if that formula changes, keep it built from real
  projections/market data, not a fabricated or hand-tuned score.
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
6. Build the real rankings/projections pipeline (replaces the heuristic in
   "Trade value methodology" with a proper server-side model).

## Commands

_(fill in once scaffolded, e.g.)_
- Dev: `npm run dev`
- Build: `npm run build`
- DB: `npx prisma migrate dev`
