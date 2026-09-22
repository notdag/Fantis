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

**Scoped exception — the player card header** (`components/PlayerCard.tsx`,
2026-08). After explicit, repeated user direction to visually match a
competitor reference (not just reorder its data), the player-card modal's
header (`.pcardhead` in `app/globals.css`) intentionally breaks two of the
rules above, but only there: a position-tinted gradient banner bleeds to the
modal's edges, and the top-right at-a-glance stat badges (`.statbadge.solid`)
use solid position/amber fills instead of tinted chips. This isn't a new
house style — the inline `.pos` meta chip on the same header stays tinted,
as does every other position chip in the app (Rankings, rosters, Team Hub).
The solid-fill treatment itself isn't unprecedented: `.trbar` and `.trcol
header` in `components/LeagueView.tsx` already use solid position-color
fills for the same "at a glance colored surface" purpose. Don't extend the
gradient banner or solid badges to other components without the same kind
of explicit discussion this one got.

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
- **FantasyCalc** (fantasycalc.com) — a real, independent trade-value number
  per player, added at the user's explicit request. Genuinely public and
  keyless (no `SHARPAPI_API_KEY`-style secret needed), but still routed
  server-side via `app/api/fantasycalc-values/route.ts` (12h cache) rather
  than called directly like Sleeper — to sidestep CORS and avoid hammering
  a free, keyless endpoint. One fixed settings snapshot (redraft, 1 QB,
  PPR, 12-team) is used everywhere regardless of a given league's actual
  settings — a real, sourced number, just not custom-fit per league.
  `lib/fantasyCalc.ts`'s `useFantasyCalcValues()`/`fantasyCalcValue()` are
  the only way to read it; used as a second, clearly-labeled opinion
  alongside Fantis's own numbers — never blended into them. Current
  consumers: Portfolio's "FC power rank" (`lib/usePortfolio.ts`), Trade's
  second-opinion values (`components/Trade.tsx`), the Rankings detail panel,
  the player card's header badge + General tab, and the League
  Rosters/Team pages under `/manager`.
- All four are read-only informational data. Rankings values are still our
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
- The curated player list lives in Postgres (2026-08 change) — the
  `RankedPlayer` model in `prisma/schema.prisma` (`order`, `name`, `pos`,
  `team`, `tier`, `posRank`), read via `GET /api/players` (unauthenticated —
  this is the same data that was already fully public in the client bundle
  before this moved, so a read-only endpoint doesn't change what's exposed)
  and `lib/usePlayers.ts`'s `usePlayers()` hook, which every component that
  used to statically import `PLAYERS` now calls instead. `lib/players.ts`
  keeps only the pure, static helpers (`POS_COLOR`, `posChipStyle`,
  `TIER_LABELS`, `TIER_COLOR`, `computePosRanks`) — no data. Saving from the
  tier board (`app/api/admin/save-tiers/route.ts`) replaces every
  `RankedPlayer` row in one transaction — recomputing `posRank` from a
  player's position within the new tier order — and it's live on the very
  next page load, in both dev and production. This replaced the original
  file-based design (`lib/players.data.ts`, hand-edited or regenerated by
  `scripts/regenPlayers.ts`/`scripts/addMissingPlayers.ts`, committed to
  git) specifically because Vercel's production filesystem is read-only:
  the save route used to have to hand back generated file source for the
  owner to paste into `lib/players.data.ts` and commit/deploy by hand.
  `lib/players.data.ts` still exists as the one-time seed the table was
  migrated from (`scripts/seedRankedPlayers.ts`) but nothing reads it at
  runtime anymore.
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
  Writes straight to the `RankedPlayer` table now (needs `DATABASE_URL`
  loaded via `dotenv`, since a standalone `tsx` script doesn't get Next's
  automatic env loading), not the old `lib/players.data.ts` file.
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
  search/trade-calculator coverage broad. Also writes straight to
  `RankedPlayer` now (appends new rows after the existing max `order`).

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

## Command Center AI (2026-09, Phase 1: READ-ONLY)

A natural-language panel at the top of `/manager` (`components/manager/CommandCenterAI.tsx`)
that scans the owner's in-season, non-best-ball leagues and answers "where is
player X available / on waivers / would need a drop", suggests drop candidates,
finds IR opportunities and roster decisions. **Phase 1 cannot change anything on
Sleeper** — `CURRENT_PERMISSION = "READ_ONLY"` in `lib/commandCenter/types.ts`,
no module under `lib/commandCenter/` may import `lib/sleeperWrite.ts` or send a
mutating request, and `scripts/testCommandCenter.ts` (`npx tsx
scripts/testCommandCenter.ts`, 120 checks) enforces that statically. Write
phases (PROPOSE_ONLY → EXECUTE_APPROVED) only on the owner's explicit request.

- **No LLM**: no Anthropic key exists in the env, so intent parsing is
  deterministic (`intent.ts`: phrase patterns + a name dictionary built from
  Sleeper's player map). Anything that sounds like an instruction to change
  something becomes `execute_request` → refusal + PREVIEW only. If an LLM is
  added later it may only pick an intent and call the read-only tools in
  `tools.ts`; it must never get a write path.
- **Live reads, not the DB snapshot**: each league is read from Sleeper's public
  API (rosters + last two legs of transactions), 5-minute cache, concurrency 6
  (~12s for 210 leagues). States are never collapsed: AVAILABLE / WAIVER /
  ON_MY_ROSTER / ON_OTHER_ROSTER / NOT_ELIGIBLE / UNKNOWN / SCAN_FAILED. A failed
  or partial league is UNKNOWN/SCAN_FAILED, never "unavailable". WAIVER = an
  unrostered player dropped within the league's `waiver_clear_days`
  (`waiver_clear_days` must stay in `SLIM_INNER_KEYS` in `lib/manager.ts`).
- **Strict player resolution** (`resolve.ts`): ≥2 current players with a name →
  ask; team-less namesakes are disclosed, never silently picked; a lone
  surname is never matched (only a few nicknames like CMC).
- **Drop candidates** (`drops.ts`): bench only; never starters, IR/taxi, the
  Priority list or the last QB/TE/K/DEF; Avoid list first, then Fantis value,
  then FantasyCalc (never blended). Every candidate lists its reasons. Not used
  (no data loaded here): ADP, recent production, snaps, depth chart, byes.
- **Audit log**: `CommandAudit` table, `/api/manager/command-audit` (admin
  cookie), one row per command.

### Command Center AI — Phases 2–5 (2026-09; requested explicitly by the owner)

The panel's mode ladder (`lib/commandCenter/proposals.ts`): **Read-only** (default) →
**Propose only** → **Execute approved** → **Auto-execute (trusted rules)**. The mode is a
browser-local setting (`components/manager/ccStore.ts`) changed only by clicking
`PermissionBar` — never by chat text. Going up to Execute/Auto needs an explicit
confirmation (Auto also needs typing AUTO); "Stop" drops to Read-only and turns every
auto rule off.

Separation that must not be broken:
- `lib/commandCenter/**` (the chat engine) has **no write path and cannot import
  `lib/sleeperWrite.ts` or `lib/commandCenterExec.ts`**. It only produces *drafts*.
  Both test suites enforce this statically.
- `lib/commandCenterExec.ts` is the **only** code that sends a change to Sleeper, and it
  only calls injected writers (the schema-checked `lib/sleeperWrite.ts`). Gates in order:
  mode allows it → proposal is `approved` → Sleeper access connected → **re-validate
  against a fresh live read** (stale → `expired`, nothing sent) → one write, **no auto
  retry** → **verify by re-reading** (unconfirmed = `verify_failed`, never "done"). A
  waiver claim can only reach `submitted` (seen pending), not "executed". Per-proposal
  in-flight guard stops a double-click sending twice.
- Proposals live in `CommandProposal` (`/api/manager/proposals`); the server enforces the
  legal status transitions (`canTransition`). Human-origin proposals always start
  `proposed`; only origin `auto` may be created pre-approved.
- Phase 3 = per-proposal Approve → "Execute…" → checkbox + "Yes, send". Phase 4 = bulk,
  its own switch, max 25, one confirmation, sequential, stops on the first unverified
  result or rejected token. Phase 5 = ONE trusted rule (IR/PUP player → open IR slot in a
  league whose rules allow it; never Out/Doubtful, never a drop/lineup/waiver), runs on a
  timer only while the page is open (the Sleeper token is browser-only), caps per run/day,
  and switches itself OFF at the first problem.
- Proposal kinds: ADD (add or waiver claim, with a suggested drop), IR_MOVE, SET_LINEUP
  (from `lib/lineupOptimizer.ts`, started games frozen).
- Tests: `npx tsx scripts/testCommandCenter.ts` (engine, 187) and
  `npx tsx scripts/testCommandCenterExec.ts` (proposals/executor/auto, 83). Live writes
  against a real Sleeper account have NOT been exercised by tests — do the first real one
  on a single low-stakes proposal.

### FantasyCalc in the database (2026-09)

FantasyCalc data is now stored in Postgres (`FantasyCalcPlayer`, `FantasyCalcValue`,
`FantasyCalcFetch`) and read per league, replacing the single fixed-format snapshot for
anything that opts in. **Their API docs (fantasycalc.com/api-docs) set hard rules:**
- **Only two endpoints may ever be called: `GET /players` (≤ once a day) and
  `GET /values/current` (≤ once an hour per format).** Anything else risks a permanent IP
  ban. `lib/fantasyCalcSync.ts` is the only code that calls them; `scripts/testFantasyCalc.ts`
  fails if it ever references another path. The hour/day limits are enforced in the DB
  (`FantasyCalcFetch`, atomically claimed before each call; failures back off too), not in
  memory. Never add a client-side or per-request call to FantasyCalc.
- **Attribution + link to fantasycalc.com must be visible wherever FantasyCalc data (or
  anything derived from it) is shown.** The Command Center panel has it; when adding FC data
  to a new surface, add the credit there too.
- They ask to be emailed before a *publicly facing* site launches with their data (see docs)
  — the owner's call, not something to do on their behalf.
- Each league maps to the nearest supported format (`lib/fantasyCalcFormat.ts`:
  dynasty/1-or-2QB/8·10·12·14-team/0·0.5·1 PPR/TE premium) — an approximation, labelled as such.
  Rows are keyed by **Sleeper id** (their `sleeperId`), so matching is exact — no name guessing.
- Read path: `GET /api/fantasycalc/league-values` (owner-only; serves from DB, refreshes stale
  formats in the background via `after()`); `POST /api/fantasycalc/refresh` forces a check
  (still bounded by the limits). Client hook: `lib/useLeagueFcValues.ts`.
- Consumers so far: Command Center drop candidates (per-league value) and the "where do I
  stand" workflow (real records vs each league's `playoff_teams`, plus FC roster-strength rank).
  The older name-keyed `/api/fantasycalc-values` proxy still serves Trade/Rankings/Portfolio.

### Bulk add/IR helpers (2026-09; requested explicitly by the owner)

Four additions on top of the existing bulk tools, all read real data already in
Fantis's own database or Sleeper's public API — none of them add a new write path.

- **FAAB bid suggestions** (`lib/faabHistory.ts`, `app/api/manager/faab-suggest/route.ts`)
  — a suggested bid computed from the league's OWN real completed waiver claims
  (`LeagueTransaction.waiverBid`, already synced), grouped by position: the p75 bid
  with 3+ real data points, the median with 1-2, always falling back to (never below)
  the league's own bid minimum when there's no history. Wired into both the Command
  Center's ADD proposal drafts (`addDraftsFromScan` in `lib/commandCenter/engine.ts`,
  via a new `get_faab_stats` read-only tool) and the Mass Add board. Rationale always
  states whether a bid was sourced from real history or fell back to the minimum —
  never silently guessed. `npx tsx scripts/testFaabHistory.ts`.
- **Multi-player add board** (`components/manager/BulkAdd.tsx`, `lib/multiAddPlan.ts`)
  — the Mass Add/Claim tab now takes up to 8 targets at once (chips, search, or one
  click from the trending panel), shows a league x target availability grid, and runs
  one combined bulk execution. `buildMultiAddPlan` is the one new piece of real logic:
  when two targets both need a drop in the SAME league, each gets a DISTINCT bench
  candidate (never proposed to drop the same player twice), and FAAB bids are summed
  per league against `budgetLeft` with a visible warning if they'd exceed it. This tool
  executes directly from the browser via `lib/sleeperWrite.ts` (like the original
  single-target version) — it is NOT part of the Command Center's proposal/executor
  pipeline. `npx tsx scripts/testMultiAddPlan.ts`.
- **Trending adds** (`lib/sleeper.ts`'s `getTrendingAdds`) — Sleeper's own public
  `/players/nfl/trending/add` list, verified live and real; one click adds a trending
  player as a target in the multi-add board.
- **Weekly sweep** (`weekly_sweep` intent in `lib/commandCenter/engine.ts`) — one chat
  command ("Run my weekly sweep") that combines the existing IR-eligible scan with an
  add/claim scan of every Priority-list player, into ONE drafts block for review. Reuses
  the existing `buildIrPlan` and `addDraftsFromScan` pipelines rather than a third
  planner; if two priority players both need a drop in the same league they could be
  proposed the same bench player, which live re-validation at execution time catches
  harmlessly (the second becomes `expired`, never a double drop) — documented in code,
  not silently wrong. Verified against the real account: 210/210 leagues scanned in
  13.1s, 59 real IR-eligible moves found (e.g. Alec Pierce, DJ Moore, both really
  listed Out).

### Chat comprehension fixes + activate-from-IR + force-start (2026-09; requested explicitly by the owner)

The owner reported the chat couldn't answer "what was my record for week 2" or
honor an inline filter like "add X if he's on waivers." Both were real gaps, not
misunderstandings — fixed, then two new capabilities were added on top, all
requested explicitly and confirmed generic (not hardcoded to any one player).

- **Week record** (`week_record` intent) — "What was my overall record for week
  2?" previously had no matching intent at all. `app/api/manager/week-record/route.ts`
  is a pure DB read (`Roster` for my rosterId, `WeeklyResult` for real won/points,
  `Matchup` for opponent) — no Sleeper call. Leagues with nothing synced for that
  week are reported as `noData`, never silently counted as a loss. Resolves "last
  week"/"this week" against `env.week`; refuses to guess if the current week isn't
  known yet.
- **`execute_request` was silently dropping inline filters** — "Add Antonio
  Williams if he's on waivers" or "...only where I don't need to drop anyone" ran
  against ALL leagues instead of the filtered set, because the intent parser threw
  the condition away before the engine ever saw it. Fixed by having
  `execute_request` carry a real `filter: ViewFilter` (same parser `scan_player`
  already used) through to `runScan`; the response now states plainly which
  leagues were included and why.
- **Activate from IR** (`activate_ir` intent, `ACTIVATE_IR` proposal kind) — "Move
  &lt;player&gt; off IR to my bench" / "activate X from IR" / "get X off IR" scans
  every league, and for each one where the player is really on IR, drafts a
  proposal to move him to the bench — with a distinct real drop candidate
  (weakest bench player by Fantis value, via the same `DropRank` used elsewhere)
  if the roster would go over the limit, or no drop at all if there's room. A full
  roster with no real bench candidate to drop is skipped and disclosed, never
  silently forced. This ONLY moves him to the bench — it never sets him as a
  starter, since that's a separate lineup decision. `lib/bulkPlan.ts`'s
  `buildActivateIrPlan` is the planner (mirrors `buildIrPlan`'s shape);
  `lib/commandCenterExec.ts`'s `runActivateIr` drops first (if needed) then
  activates, verifying by re-read same as every other executor. Verified against
  the real account: Michael Pittman was really on IR in 51 of 210 leagues, each
  got a distinct real drop suggestion (Tank Bigsby, Antonio Williams, Emari
  Demercado, etc., varying per roster).
- **Force start** (`force_start` intent) — "Make sure &lt;player&gt; starts this
  week" forces ONE named player into the optimizer's priority ranking (rank 0,
  NOT merged with the owner's saved Priority list — this is a one-off per-command
  override, not a standing change) and re-runs `optimizeLineup` per league. The
  hard safety rule: a player who is really `Out`/`IR`/`PUP`/`Sus`/`Doubtful` or on
  a real bye is NEVER force-started — same `isUnavailable` check `lineup_improvements`
  already uses — and a game that's already kicked off is never touched either. Every
  league is accounted for in the summary (already starting / drafted / on IR / a real
  status makes him unavailable / game locked / no eligible slot for his position) —
  never silently dropped from the count. Requires `env.projections` and
  `env.kickoffs`; refuses to guess if either hasn't loaded. Works for any player,
  not just the one named in the request that prompted it. Verified against the
  real account: Drake London was already starting in 15 of 16 leagues; the one
  where he wasn't drafted a real proposal ("Drake London for Stefon Diggs at WR,
  +3.7 projected").
- Tests: 30 new assertions across `scripts/testCommandCenter.ts` (now 279) covering
  both the bug fixes and both new intents; `scripts/testCommandCenterExec.ts` gained
  7 for the `ACTIVATE_IR` executor (now 95) — open-roster no-drop, full-roster with
  a drop, drop failure blocking activation, stale-state re-validation (no longer on
  IR / roster now full), and unconfirmed re-read never claiming success.

### Lineup optimizer tie-breaks: true slot, Thursday/Monday placement, curated rankings (2026-09; requested explicitly by the owner)

`lib/lineupOptimizer.ts`'s Hungarian assignment picks the real point-optimal
lineup, but real point value doesn't depend on WHICH eligible slot a player
lands in (a WR in "WR2" and the same WR in "FLEX" score identically) — so
ties between a true position slot and FLEX were previously broken by solve
order, not intent. Three small, deliberately tiny tie-break bonuses were
added on top of the existing point-optimizer, each far below any real point
difference so none of them can ever override the week's actual projections
— they only decide what the projections themselves leave genuinely tied:

- **A forced/priority player's own true slot over FLEX** (`PRIORITY_TRUE_SLOT_BONUS`)
  — "make sure Drake London starts" force-starting him, or a Priority-list
  player in "Fix my lineups", now lands in his real position slot rather
  than FLEX when both are open and equally good. Verified the bug was real
  before fixing it (reverted the fix, re-ran the same scenario, confirmed it
  failed) and added a regression test that would catch a re-break.
- **Real kickoff day → slot preference** (`gameDay`, `THU_TRUE_SLOT_BONUS` /
  `MON_FLEX_SLOT_BONUS`, "Fix my lineups" only) — a Thursday-game player is
  nudged into his true position slot (his decision locks first, no benefit
  to leaving him "floating" in flex); a Monday-game player is nudged into
  FLEX instead (his decision locks last, so the most flexible slot holds the
  week's latest, most-informed call). Derived from the same real kickoff
  timestamps already used to freeze locked games — never a guess, and never
  strong enough to bench a genuinely better player just to satisfy the
  placement preference.
- **Curated `/admin` rankings as a tie-break, not an override** (`rankTiebreak`,
  `RANK_TIEBREAK_STEP`/`RANK_TIEBREAK_CAP`, "Fix my lineups" only) — when two
  eligible players are genuinely tied in real projected points, the one
  ranked higher in the owner's own curated list wins the slot. This is
  deliberately a SEPARATE, much smaller mechanism from `rankOrder`
  (BulkOptimize's existing "rankings mode" toggle, a full preference BAND
  that ranks purely by curated order and ignores the week's projections
  entirely) — conflating the two would have made the default "Fix my
  lineups" flow silently stop being projection-driven. Verified a genuine
  8-point real projection edge is never overridden by curated rank.
- Because these are pure tie-breaks, a swap with ~zero real point gain
  (a pure Thursday/Monday reslot, or a curated-rank pick between exactly
  tied players) would have been silently dropped by the existing "only
  propose real gains ≥ 0.05 points" filter. Fixed by re-running the
  optimizer WITHOUT the new tie-break bonuses when the with-bonus gain is
  under that bar: if the plain run also finds nothing, the visible change is
  purely a tie-break fix and is proposed anyway (labelled honestly as
  "slot fix — no point change", never a fake "+0.0 projected"); if the plain
  run finds a real gain, the marginal-gain filter still applies as before.
- Tests: 11 new assertions in `scripts/testCommandCenter.ts` (now 293) —
  Thursday player moved out of FLEX into his true slot, Monday player moved
  the other way, both at zero real gain; curated rank deciding a genuine
  tie; no change when curated rank already favors the current starter; a
  real projection edge never overridden by rank. Verified live: "Fix my
  lineups" against the real 210-league account surfaced real Thursday/Monday
  slot fixes consistent across leagues sharing a bye/kickoff pattern (e.g.
  Saquon Barkley repeatedly moved RB→FLEX opposite whichever RB was on his
  true-slot side), confirming the signal is real schedule data, not noise.

### Chat: surname-only player names, broader "start X" phrasing (2026-09; requested explicitly by the owner)

The owner's core complaint: they shouldn't have to phrase things like one of
the example chips, "esp with the players." Still no LLM (explicitly declined
in favor of the free, deterministic path when offered the choice) — two
concrete, scoped gaps closed instead:

- **Surname-only mentions** (`lib/commandCenter/resolve.ts`) — "Pittman" (not
  "Michael Pittman") previously matched NOTHING: `buildPlayerIndex` only
  keyed players by their full normalized name, and `findMentions` explicitly
  refused every single-word candidate except a five-entry nickname table
  ("because a lone surname is far too ambiguous to trust" — the old
  reasoning). Now `buildPlayerIndex` also indexes every player by last name
  alone, and `findMentions` accepts a single-word match — but ONLY when it
  isn't one of this app's own ~90 stopwords (its command vocabulary: add,
  drop, start, week, roster, league, etc., plus ordinary articles/pronouns/
  prepositions). A real, unambiguous surname resolves exactly like a full
  name always has; a SHARED surname still asks which player rather than
  guessing (`resolveName`'s existing `active.length >= 2` check needed no
  changes — a shared surname is no different to it than a shared full name).
  The stopword list exists so the app's own vocabulary can never misfire as
  a player mention even if some real NFL player happens to share it — tested
  directly: a synthetic player surnamed "Start" is still found when actually
  named, but never triggers on an ordinary sentence containing "start".
  First names are deliberately NOT indexed alone — far more collisions
  (many "Josh"/"Michael"s) for less real benefit, since surname-only is how
  people actually refer to NFL players.
- **`force_start` phrasing** (`lib/commandCenter/intent.ts`) — "start
  &lt;player&gt; in all my leagues" / "...across my leagues" / "...in every
  league" didn't match the old trigger regex (it only recognized "in my
  lineups" or the exact phrase "across my leagues"); a bare "start
  &lt;player&gt;" with a recognized mention now also matches directly.
- Tests: 10 new assertions in `scripts/testCommandCenter.ts` (now 303) —
  surname resolves like a full name, namesake disclosure still works,
  a shared surname still asks, the stopword-collision guard (both that it
  suppresses AND that it still finds the same player by full name), an
  unrelated intent (`lineup_improvements`) is never derailed by a
  stopword-colliding surname sitting in the roster, and the new `force_start`
  phrasing variants. Verified live against the real account: "start Pittman
  in all my leagues" resolved Michael Pittman with no clarification needed
  and correctly routed to force_start, matching the same real IR data
  ("on IR/taxi in 51") already confirmed in the activate-from-IR feature.

### Chat: "put &lt;player&gt; on IR" (2026-09; requested explicitly by the owner)

The reverse of `activate_ir` (which only ever moves IR → bench) was missing:
"put Drake London on IR" / "move X to IR" fell into the generic
`execute_request` catch-all and only ever produced a refusal + preview, never
a real per-league IR eligibility check the way `activate_ir` and
`force_start` do. New `send_to_ir` intent (`lib/commandCenter/intent.ts`,
trigger regex requires "on/to/onto/into/in (the) IR", never "off/from" —
the two directions can't collide) and engine case
(`lib/commandCenter/engine.ts`) close that gap:

- Every league where he's rostered is accounted for, never silently
  dropped: already on IR (disclosed separately), not IR-eligible under that
  league's own real rules (healthy, or a status like Doubtful that
  deliberately never qualifies — reuses `irAllowed`, no new eligibility
  logic), IR-eligible with an open slot (drafted), or IR-eligible but that
  league's IR is already full (reported honestly, never auto-proposed —
  matches `ir_opps`'s existing behavior, since releasing an IR occupant to
  make room isn't something this app writes for).
- Reuses `buildIrPlan` (the same planner `ir_opps` already uses for its
  general "who could go on IR" scan) filtered down to the one named player,
  rather than a second parallel implementation of the same real slot-math.
- Tests: 11 new assertions in `scripts/testCommandCenter.ts` (now 314) —
  open-slot proposal, full-IR league reported not drafted, already-on-IR
  disclosed separately, a healthy player never proposed, not-rostered
  message, and phrasing variants ("put X on IR", "move X to IR", "send X to
  IR", "place X on injured reserve"). Verified live against the real
  account: "put Alec Pierce on IR" found him real-eligible in 14 leagues (10
  open slot, 4 full IR reported honestly), matching his actual "Out" status
  already confirmed via the weekly-sweep feature.

### Chat: multi-target "add X and Y" — distinct drop per target (2026-09; requested explicitly by the owner)

The owner asked whether mass-adding via waiver with FAAB and drop suggestions
— already built for the dedicated Mass Add board (`lib/multiAddPlan.ts`) —
also worked from chat. It did reach real proposals (`scan_player` for a bare
multi-mention, or `execute_request` for "add X and Y everywhere" — both
funnel through the same `runScan`/`addDraftsFromScan` pipeline), but had the
exact bug `buildMultiAddPlan` was built to avoid: `addDraftsFromScan` picked
`drops[leagueId].candidates[0]` (the single best bench candidate) for EVERY
target in a league, so two targets both needing a drop in the same league
would have been proposed to drop the SAME bench player — the second
proposal would fail (or double-drop) if both were approved.

Fixed by tracking claimed drop candidates per league within one batch
(`claimedByLeague` in `addDraftsFromScan`) and picking the next-best
UNCLAIMED candidate for each subsequent target — `DropAnalysis.candidates`
is already a ranked, non-target-specific list (only excludes the incoming
player himself), so this is a minimal, surgical fix rather than porting
`multiAddPlan.ts`'s separate `PlanLeague`-based implementation into the chat
engine. Since `addDraftsFromScan` is shared by `scan_player`, the `filter`
follow-up, and `weekly_sweep`, all three get the fix at once. FAAB bids
needed no change — `suggestBid` is already independent per (league,
position), so there's no collision risk there.

Tests: 7 new assertions in `scripts/testCommandCenter.ts` (now 321) — a
synthetic full-roster league with two targets, confirming distinct drop
names on both the bare-mention and "add X and Y" phrasings. Verified live
against the real account: "add Malachi Fields and Germie Bernard everywhere"
found 31 real leagues where both were proposed together, and every single
one got a distinct drop suggestion — zero duplicates.

### Chat: owner-specified drop order for a mass add (2026-09; requested explicitly by the owner)

The owner wanted a two-step flow for tonight's waivers: "add these players,
in my order" first, then "here's who to drop, in that order, if applicable"
as a follow-up — using their OWN drop preferences instead of Fantis's
auto-picked weakest-bench-player, and explicitly wanting any league where
none of it applies called out by name (never silently skipped).

New `drop_preferences` intent/case, distinct from the ordinary drop-verb
`execute_request`:

- **Only recognized as a follow-up** (`ctx.hasScan` — a prior add/scan is on
  the session): a bare "drop X" with nothing on screen is still the ordinary
  ("I don't drop anything from chat, here's what dropping X would look like")
  path, unchanged. A drop-follow-up that also says "everywhere"/"in my
  leagues" is excluded too, so a fresh multi-target drop request still goes
  through the normal path instead of being misread as a preference list for
  an old scan.
- Re-reads a fresh roster snapshot for every league that needed a drop from
  the last scan (`get_league_snapshot`, same pattern the `drops` follow-up
  already uses) rather than trusting the auto-ranked top-3 `DropAnalysis`
  list, because the owner's named player might not be in that top-3 at all —
  this checks the FULL roster.
- For each league, walks the owner's list in order and proposes the first
  name that's actually on that roster as an eligible bench player — never a
  current starter, never on IR/taxi, never on the Priority list, even if
  explicitly named (same hard exclusions the rest of the app already uses).
  A league where none of the list matches is disclosed by name in a
  `decisions` block, never silently dropped from the count.
- Reuses the SAME per-league "claimed" tracking as the auto multi-add fix
  above, so if two targets both need a drop in one league, they still get
  two DIFFERENT names off the owner's list, never the same one twice.
- Real FAAB bids per proposal, same `suggestBid` path as everywhere else.
- Tests: 10 new assertions in `scripts/testCommandCenter.ts` (now 331) —
  distinct assignment within a league, a league with no matching name
  disclosed, a named starter never auto-dropped, a bare "drop X" with no
  scan on screen never misread as a preference list, nothing-needed-a-drop
  handled cleanly. Verified live: "add Malachi Fields and Germie Bernard
  everywhere" then "drop Antonio Williams, then Tank Bigsby, then Samaje
  Perine" matched 125 of 207 real leagues that needed a drop and disclosed
  the other 82 by name; re-checked the matched leagues for duplicate
  assignments within that one turn and found none.

### Combined "add X, Y, drop A, B if needed"; IR open-bench-slot report; bulk cap 25→200 (2026-09; requested explicitly by the owner)

Three requested follow-ups on the above, all shipped together:

- **Combined single-message drop order** — the two-message drop_preferences
  flow can now be written in ONE message: "add X, Y, drop A, B if needed".
  `lib/commandCenter/intent.ts`'s `execute_request` now splits the sentence
  at the first standalone "drop"/"dropping" token (never mid-word, e.g.
  never inside "Dropbox") when the primary verb isn't itself "drop" —
  mentions before the split are the add targets, mentions after are the
  drop order. The shared per-league matching logic (full roster re-check,
  never a starter/IR/priority player, one name claimed per league) was
  extracted out of `drop_preferences` into `applyDropOrder`, now called by
  both: the follow-up passes `openSlot: []` (those leagues were already
  proposed on the earlier turn), the combined syntax passes both the
  needs-a-drop AND the open-slot rows so nothing from the single message is
  left uncovered. Verified live: "add Malachi Fields and Germie Bernard
  everywhere, drop Antonio Williams then Tank Bigsby if needed" produced 110
  real proposals in one call (99 via the drop order, 11 open-slot), with 8
  leagues getting both targets proposed together — every one with correctly
  distinct treatment.
- **IR opportunities: open bench slot after the move** — `ir_opps` now also
  reports which leagues would have an open bench/active slot once the
  proposed IR moves go through (real roster math — a player moving from
  active to IR always frees the slot behind him, computed from the league's
  real `roster_positions` length and current active count, not a guess).
  Ties directly into the mass-add workflow: those are the leagues where a
  waiver add could follow without needing its own drop. Verified live: 41 of
  75 real leagues would open a slot if all 50 proposed IR moves went through.
- **Bulk execution cap: 25 → 200** (`components/manager/ProposalsPanel.tsx`,
  `BULK_CAP`) — the owner has 200+ leagues and wanted to run bulk sends
  across all of them, not in batches of 25. Purely the ceiling: still
  sequential (concurrency 1, 400ms gap), still stops at the first
  unverified result or an auth error, still one confirmation checkbox
  before anything sends. (Phase 5's separate auto-execute "max per run" cap,
  a deliberately more conservative limit for UNATTENDED execution, was left
  at 25 — not part of this request and a materially different risk profile.)
- Tests: 12 new assertions in `scripts/testCommandCenter.ts` (now 339) —
  the combined syntax's distinct assignment and open-slot coverage in one
  message, the IR open-bench-slot math (including a league with no real
  move never appearing in the report).

### Chat: "move all my IR eligible players to IR" fell into the wrong path (2026-09; found while confirming the above)

Asked to confirm everything worked, tested this exact phrase and found it
was silently broken: `ir_opps`, `waiver_opps`, and `roster_decisions` were
all still checked AFTER the generic `execute_request` verb match in
`lib/commandCenter/intent.ts`, unlike `activate_ir`/`send_to_ir`/
`force_start`/`drop_preferences`, which were already moved ahead of it for
exactly this reason. Any of these three starting with "move"/"put"/"send"/
"add" (all recognized execute_request verbs) got swallowed by the generic
refusal-plus-preview path instead — which, with no player named, falls
through to "Tell me which player to look at first," a useless answer to
"move all my IR eligible players to IR."

Fixed by moving all three checks ahead of the execute_request match, same
position as the others. Doing so exposed a second, latent bug: `waiver_opps`
had no `mentions.length === 0` guard, because it never needed one while
execute_request still ran first — moved earlier, "add Puka Nacua and Antonio
Williams" would have matched its `add targets?` pattern (literally: "add"
followed by the word "target") purely by coincidence and been swallowed too.
All three now explicitly gate on `mentions.length === 0`, so a real named
player always reaches scan_player/execute_request as before.

Tests: 5 new assertions (now 344) — all four IR-mass-move phrasings route to
`ir_opps`; a real named add is never swallowed by the waiver/IR/roster-
decision shortcuts. Verified live: "move all my IR eligible players to IR"
now returns the real scan (99 players, 75 leagues) instead of the dead-end
fallback.

### Chat: force_start silently ignored every named player but the first (2026-09; found while confirming with the owner)

Asked to confirm "make sure Drake London and Puka Nacua start" would work —
it wouldn't have. `parseIntent`/`findMentions` correctly picked up both
names, but the engine's `force_start` case did `const player = resolved[0]`
and only ever acted on the first one, silently dropping the rest with no
error or warning.

Rewrote the case to force ALL named players together: one `optimizeLineup`
call per league with every named player's id in the SAME `priorityRank` map
(ranked by the order they were named, as a tie-break only if two of them
ever compete for one slot), so a league where both are addable gets ONE
combined `SET_LINEUP` proposal, not two conflicting ones. Every other
existing safety rule now applies per player independently within that same
pass — one being genuinely Out/bye/locked/already-on-IR never blocks the
other from being forced in the same league — and each player gets his own
summary line (already starting in N, can be started in N more, etc.),
exactly the same wording the single-player case already used, just looped.

Tests: 12 new assertions in `scripts/testCommandCenter.ts` (now 355) — both
players forced together in one league overriding a much-higher-projected
bench player, a league where only one of the two is rostered, a league
where one is already starting and only the other gets proposed, and an Out
player never force-started even though the other named player in the same
command still gets forced in the same league. Verified live: "make sure
Drake London and Puka Nacua start this week" now reports both players
independently and correctly (16 leagues / 12 leagues already starting,
Puka Nacua's IR and bye-week leagues disclosed separately) instead of
silently dropping Puka Nacua.

### Chat: swept the rest of the "only acts on the first named player" bug (2026-09; found auditing after the force_start fix)

Asked to double-check for anything else of the same shape before real use.
`grep`ping for the exact pattern that caused the force_start bug
(`resolved[0]`) found two more real instances — `activate_ir` and
`send_to_ir` had the identical flaw: the parser found every named player,
the engine only ever acted on the first.

- **`activate_ir`** (IR → bench, multiple players): now loops all named
  players, and reuses the same per-league "claimed" drop tracking as the
  multi-add fix — two IR players activated together in the same league get
  DISTINCT bench drops, never the same one twice. `SEVERITY` exported from
  `lib/bulkPlan.ts` for reuse (was file-local before).
- **`send_to_ir`** (→ IR, multiple players): rebuilt the open-IR-slot
  competition to run across only the NAMED players sharing a league
  (severity-ordered, first-named wins a tie) — deliberately does NOT pull in
  other, un-named injured players on the same roster; this command is
  scoped to exactly who was asked for, not a general sweep.
- **A third, separate bug found in the same audit**: the multi-player
  "add X, Y, drop A, B" combined syntax only worked when the sentence
  literally started with a recognized verb (add/claim/put/...). A natural,
  non-imperative phrasing like "I want to waiver Jonah Coleman in all
  leagues and drop Tank Bigsby" doesn't start with one of those, so it fell
  through to `scan_player` instead — and Tank Bigsby got treated as a
  SECOND player to add, not a drop order. Fixed by moving the "mentions
  before AND after a standalone drop/dropping token" split to run
  independently of the leading verb, checked before the verb match — so it
  now applies to any phrasing, imperative or not.
- Tests: 15 new assertions in `scripts/testCommandCenter.ts` (now 365) —
  distinct drop assignment for two IR-activation players in one league,
  two players competing for one real open IR slot (first-named wins,
  second honestly reported as blocked), and the natural-phrasing drop-order
  split. Verified live: "put Alec Pierce and Antonio Williams on IR"
  and "move Michael Pittman and Alec Pierce off IR to my bench" both
  correctly reported each player independently against real data; "I want
  to add Malachi Fields in all my leagues and drop Antonio Williams"
  correctly read Antonio Williams as the drop order, not a second add.

One real, pre-existing behavior worth knowing (not a bug, but relevant to
how the owner described this workflow): the word "waiver" inside a request
("I want to *waiver* him") sets a real state filter — only leagues where the
player is literally on the waiver wire, not just any free agent — same
filter `parseFilter` already applies everywhere else. A pure free agent
in a league that filter excludes is not a bug; say "add" instead of
"waiver" for "anywhere he's addable, however."

### Chat: "drop candidates" fell into the same dead-end as "move all my IR eligible" (2026-09; found in a final pre-deploy sweep)

One more of the exact collision class fixed earlier for ir_opps/waiver_opps/
roster_decisions: a genuinely informational query that happens to start with
a word `execute_request`'s verb match grabs first. "Drop candidates for my
worst players" (or just "drop my worst players") starts with the bare word
"drop" — with no player named, it fell into the generic refusal-plus-preview
dead end instead of the real `drops` intent.

Fixed narrowly rather than reordering `drops` relative to
`candidate_leagues`/`aggregate_drops` (which it deliberately excludes
"which league(s)" phrasing to stay out of the way of) — a small, separate
pre-check for the specific colliding shape: no player named, sentence starts
with "drop", and contains the same informational language (bottom/worst/
weakest/candidates) the real `drops` trigger already looks for. A real
"drop &lt;player&gt;" request is completely untouched.

This was found by grepping the codebase for every remaining
`execute_request`-verb word (add/drop/claim/move/put/start/bench/...) against
plausible informational phrasing that could start a sentence with one of
them — the same audit technique that found the IR/waiver ordering bug.
Nothing else turned up.

Tests: 2 new phrasing variants added to the existing drops test in
`scripts/testCommandCenter.ts` (now 367). Verified live: "drop candidates
for my worst players" now returns the real 210-league scan instead of the
dead-end fallback.

### Priority list wasn't respected when suggesting who to release from IR (2026-09; real bug reported by the owner)

The owner reported "I cannot have Jordyn Tyson dropped from IR" after
running the bulk IR scan — a league with a full IR suggested releasing him
to make room for a different player going to IR. Root cause: unlike the
regular bench-drop logic (`analyzeDrops`, which has always excluded the
Priority list), the "who to release from IR" candidate pools in
`lib/bulkPlan.ts`'s `buildIrPlan` and `buildActivateIrPlan`, and
`lib/multiAddPlan.ts`'s `buildMultiAddPlan`, never checked it at all —
purely ranked by Fantis/FantasyCalc value, so an uncurated player (value 0,
sorts as "weakest") could get suggested for release regardless of whether
the owner had marked him protected.

All three now take an optional `isPriority` callback (default
`() => false`, so nothing breaks if a caller doesn't pass one) and filter
the candidate pool before ranking — same rule bench drops already followed,
now consistent everywhere a "who to drop to make room" suggestion appears:

- `ir_opps` and `weekly_sweep` (chat) — the informational "would need to
  release X" text in the bulk IR scan.
- `activate_ir` (chat) — the REAL bench-drop proposal when activating him
  off IR needs room; this one is more serious than the informational IR
  case since it's an actual proposal that could be approved and sent.
- `BulkIR.tsx` and `BulkAdd.tsx` (the UI tools under /manager/lineups) —
  neither previously received the owner's `prefs` at all; now both do
  (threaded through from `LineupManager.tsx`), so the Mass IR and Mass
  Add/Claim boards respect Priority the same way chat does.

If every real candidate in a league is Priority-protected, the honest
result is "nobody clear to drop" — never a silent fallback to suggesting a
protected player anyway.

Tests: 5 new assertions in `scripts/testMultiAddPlan.ts` (now 20) and 3 in
`scripts/testCommandCenter.ts` (now 370). Verified live end-to-end against
the real account: confirmed the owner's Priority list was actually empty
(so Jordyn Tyson wasn't protected yet, which is why the bug was visible at
all even before this fix existed to matter), added him via
`/api/manager/preferences` (id `13281`, resolved from Sleeper's real player
list — a Fantis-only preference write, never touches Sleeper), then
re-ran the 210-league bulk IR scan and confirmed his name appears nowhere
in the 72-league result.

### Standalone release (DROP) + `ir_opps` release order (2026-09; requested explicitly by the owner)

Follow-up to the Priority fix above: the owner pointed out the bulk `ir_opps`
scan only ever *reported* that a full-IR league "would need to release X" —
there was no way to actually act on that. They wanted to give the app a
standing, ordered list of players they're fine releasing off IR (Isiah
Pacheco, Dylan Sampson, Christian Kirk, James Conner), so a full-IR league
can really pair a release with the new player's IR move in one command.

- **New `DROP` proposal kind** (`lib/commandCenter/proposals.ts`) — a
  standalone release with no accompanying add: `dropDraft()` builds it,
  `validateAgainstLive`'s `"DROP"` case re-checks the player is still really
  on the roster before sending, `sanitizeDraft`/`draftKey` cover it like
  every other kind. `lib/commandCenterExec.ts`'s `runDrop` is the only new
  writer path — it calls the same `addDropFreeAgent` mutation the ADD flow
  already uses, just with no `addPlayerId`, then verifies by re-read that
  the player is gone. `gate()` already restricted Phase 5 auto-execute to
  `IR_MOVE` only, so a `DROP` can never run unattended without a separate,
  deliberate change.
- **`ir_opps` release order** — "move all my IR eligible players to IR,
  release Isiah Pacheco, Dylan Sampson, Christian Kirk, James Conner if
  needed" now parses as `ir_opps` with a `releaseOrder` (`intent.ts`'s
  `splitAtDropKeyword`, reused from the existing add+drop combined syntax).
  For each league where `buildIrPlan` reports `needsDrop`, the engine tries
  the release order in the order given, skipping anyone already claimed for
  that league or not really a current IR occupant there (`r.dropCandidates`
  — which already excludes Priority-listed players via the fix above) —
  and drafts a `DROP` immediately followed by the `IR_MOVE`, in that order.
  The bulk executor runs proposals one at a time and stops on the first
  unverified result, which is what makes the ordering safe: the IR_MOVE is
  only ever attempted after the release is confirmed, and a stale/expired
  release blocks its paired move rather than silently skipping ahead.
  Leagues where none of the named players are real occupants there fall
  back to the original informational-only text, honestly, same as before
  this feature existed.
- **Routing bug found and fixed while building this**: the release-order
  phrasing introduces a real player mention (the release names), which sent
  it straight into `send_to_ir`/`activate_ir`'s existing "move ... to IR"
  matchers (checked earlier in `intent.ts`, gated only on
  `mentions.length > 0`) before it ever reached the `ir_opps` block. Fixed
  by hoisting the release-order detection above both of those checks —
  it only fires when the bulk-scan half of the sentence has no mentions of
  its own (`split.before.length === 0`), so an ordinary single-player "move
  X to IR" still reaches `send_to_ir` exactly as before.
- Distinct assignment: a release name is claimed by at most one league need
  at a time (`claimedReleaseByLeague`, same pattern as every other
  distinct-assignment fix this session). Note the pure planner
  (`buildIrPlan`) already does its own distinct auto-pick internally, so
  when a league's IR pool has only one real occupant and two new players
  both need a release, the *second* row's fallback text correctly says "IR
  is full and nobody on it can be released" (the planner already exhausted
  its own pick), not a reuse of the same occupant's name.
- Tests: `scripts/testCommandCenterExec.ts` gained a standalone-DROP
  execution section (success, live re-validation expired, write failure,
  unconfirmed verify_failed, and the full release-then-IR-move sequence
  proving the ordering safety property) — now 103. `scripts/testCommandCenter.ts`
  gained section 33 (release-order pairing, distinct assignment within one
  league, the no-match fallback, and Priority protection holding even when
  the owner names a protected player directly) — now 384.
- Verified live against the real account with the owner's actual phrasing:
  "move all my IR eligible players to IR, release Isiah Pacheco, Dylan
  Sampson, Christian Kirk, James Conner if needed" scanned 210/210 leagues
  in 5.0s, found 96 real IR-eligible players across 72 leagues, and 25 of
  those pairs genuinely used the release order (e.g. Fantic Redraft League
  #100: release Dylan Sampson, then move Jayden Daniels to IR). Leagues
  where none of the four were real IR occupants still got the honest
  fallback text. Confirmed read-only throughout — no Sleeper token was
  connected in this session, so nothing could have been sent regardless.

### Standing IR Release list + splitting the report from the real drop (2026-09; real bug reported by the owner)

The owner reported that a bare "suggest me players to move to IR" was still
naming players other than their real fixed list (Isiah Pacheco, Dylan
Sampson, Christian Kirk, James Conner, Tank Dell — "these are the only
players that can be dropped if we need to make space for IR"). Two real
gaps, both fixed:

1. **The release order from the section above only ever applied when typed
   inline, every single message.** Fixed by giving `PlayerPrefs` a third,
   persisted list — `irRelease: string[]` (ordered, same shape as
   `priority`) — stored the same way Priority/Avoid already are, via
   `/api/manager/preferences` (`PlayerPreference.kind = "ir_release"`; a
   player can only be in one of the three lists at once, same as
   priority/avoid today — `playerId` is the table's primary key). Editable
   under Chat tab → My players (`components/manager/PlayerPreferences.tsx`,
   a third "IR Release" section, same add/reorder/remove UI as Priority).
   `DropSignals.irReleaseOrder` carries it into the engine.
2. **Even WITH an inline or standing release order active, the honest
   "IR full — would need to release X" fallback text still named the real
   weakest IR occupant by value when none of the owner's list matched that
   particular league — not one of the approved names.** That's the literal
   bug reported: a real, unapproved player kept showing up. Fixed by making
   an active release order (inline OR standing) STRICT: the fallback now
   says "none of your release list (...) is on IR in this league" instead
   of ever naming an unapproved occupant, in `lib/commandCenter/engine.ts`'s
   `ir_opps` case.

A third, deliberate design change came out of testing this live: the first
version of the standing list made a completely bare "move all my IR
eligible players to IR" auto-draft real release+move pairs the moment a
standing list existed — collapsing what the owner explicitly wanted as
**two separate commands** back into one. Split for real now:

- **"move all my IR eligible players to IR"** (bare, no "drop"/"release"
  word at all) — stays pure report-only, and uses the ORIGINAL unrestricted
  wording (names the real weakest occupant), exactly as if this whole
  feature didn't exist. A standing list configured has zero effect on this
  phrasing.
- **"...and drop" / "...then drop" / "...drop if needed"** (the word
  present, names optional) — the new `Intent`'s `useStandingRelease` flag
  (`lib/commandCenter/intent.ts`), set only when a drop/release trigger
  word appears with no names after it. This is what actually applies the
  standing IR Release list and drafts real `DROP`+`IR_MOVE` pairs, strict
  allow-list, same as an inline release order.
- An inline release order (explicit names, e.g. "...release Isiah Pacheco,
  Dylan Sampson if needed") still works exactly as before and wins over the
  standing list for that one command, whether or not "and drop" is also
  present.

Tests: 21 new assertions in `scripts/testCommandCenter.ts` (section 34, now
398) — the bare command staying report-only even with a standing list
configured, the "and drop" variants (three phrasings) applying it and
drafting real pairs, an inline order overriding the standing list, strict
fallback naming the list (not a real occupant) for both the inline and
standing paths, and a no-op empty-list case matching original behavior
exactly. Verified live against the real account after saving the owner's
actual 5-name list via `/api/manager/preferences` (ids resolved from
Sleeper's public player dump: Pacheco `8205`, Sampson `12469`, Kirk `4950`,
Conner `4137`, Dell `9502`) and reordering it live to Conner-first per a
follow-up request: the bare command reported 96 players/72 leagues with
completely unrestricted wording (named real occupants like Zach Charbonnet
who aren't on the owner's list); "...and drop" reported the same 96/72 but
29 of those pairs now used only the 5 approved names, in the exact order
saved, and neither Conner nor Kirk were used anywhere this week because
neither is actually on any real IR right now — confirmed honest, not
fabricated. Confirmed read-only throughout, zero Sleeper writes.
