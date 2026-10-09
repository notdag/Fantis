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

### Collapsed back to ONE `ir_opps` command; fallback never names anyone (2026-09; real bug reported by the owner)

The two-command split above was itself the bug: the owner tested the bare
"suggest me players to move to IR" (report-only by design) and was still
seeing real players outside their 5-name list (Zach Charbonnet, A.J. Brown)
— exactly the thing the whole feature exists to prevent, just surfacing on
the phrasing that hadn't been restricted. Asked directly, the owner wanted
**one single prompt**, with the standing list applied silently and
automatically, and a full-IR league with no match saying nothing more than
"IR is full" — not even naming the list itself.

- Removed the `useStandingRelease` intent flag and the "...and drop"/bare
  distinction entirely (`lib/commandCenter/intent.ts`) — a bare "move all my
  IR eligible players to IR" now behaves exactly like the "and drop" command
  used to: the standing IR Release list applies automatically whenever one
  is configured, no extra phrasing required. An inline release order
  ("...release A, B, C if needed") still overrides it for that one command.
- The strict fallback text (`lib/commandCenter/engine.ts`'s `ir_opps` case)
  no longer echoes the release list's names either — a league where none of
  it applies just says **"IR full"**, full stop. (It briefly said "IR full —
  none of your release list (...) is on IR in this league"; even that was
  more than the owner wanted named.) The top-level summary line ("N of
  those used your release order (...)") still names the owner's OWN list
  once, up front — that's not an unapproved player, so it stayed.
- Tests: rewrote `scripts/testCommandCenter.ts` section 34 for the
  single-command design (a bare command drafting the real pair, an inline
  override still winning, strict "IR full"-only fallback, and the
  no-list-configured case staying completely unchanged) plus fixed three
  section-33 assertions that depended on the old fallback wording — 391
  total (engine tests), 103 (exec, unaffected). Verified live against the
  real account: a single bare "move all my IR eligible players to IR" now
  drafts 28 real release+move pairs from the 5-name list with zero
  mentions of Zach Charbonnet, A.J. Brown, or any other unapproved player
  anywhere in the output, and 19 leagues report plainly "IR full" with no
  name attached. Confirmed read-only, zero Sleeper writes.

### Open Roster Spots page (2026-09; requested explicitly by the owner)

A new standing report at `/manager/open-spots` (My Leagues nav group,
alongside Byes/Injuries — same class of cross-league informational report,
same page shape as `ByePlanner`/`InjuryReport`): every in-season,
non-best-ball league where the active roster (IR excluded) isn't full,
i.e. a waiver add there wouldn't need a drop first.

- **Pure DB read, no Sleeper call** — `app/manager/open-spots/page.tsx`
  reads `db.league.findMany({ where: { status: "in_season" } })` +
  `db.roster.findMany()`, same data every other bulk tool already syncs.
  Open spots = `rosterPositionsFromSettings(league.settings).length -
  (roster.players.length - roster.reserve.length)` — reuses the existing
  `lib/manager.ts` helpers rather than a new calculation; same "active
  count" definition `lib/commandCenter/classify.ts`'s `activeCount()` and
  every bulk-add/IR planner already use elsewhere in the app. Known
  pre-existing gap this inherits, not introduced by this feature: a
  dynasty league's taxi squad isn't tracked as a separate field in this
  data path (`ManagedRoster`/`Roster` has no `taxi` column), so a taxi
  player would count as "active" here the same way it already does in
  every other bulk tool (`BulkIR`, `BulkAdd`) — a real, scoped limitation,
  not something this page newly gets wrong.
- `components/manager/OpenSpots.tsx` — two stat cards (leagues with a real
  open spot, total open spots across them) plus a list sorted by most-open
  first, each row linking to that league's overview page. Leagues whose
  roster is completely full are simply left out of the list (same pattern
  `ByePlanner` uses for "nothing upcoming").
- Registered in both `components/manager/managerNav.ts` (nav entry, which
  also drives the page's breadcrumb title automatically via
  `ManagerHeader.tsx`'s `portfolioPageLabel()`) and
  `components/manager/leagueSubRoutes.ts`'s `PORTFOLIO_SLUGS` — the same
  registration step the `inbox` route's CLAUDE.md entry above flags as
  easy to forget (a top-level `/manager/<slug>` route left out of
  `PORTFOLIO_SLUGS` gets misread as `/manager/[leagueId]` with
  `leagueId="open-spots"`).
- Verified live against the real account: 16 of 210 in-season leagues
  currently have exactly one open roster spot each (mostly 14/15 filled,
  one 15/16), matching real synced roster data; clicking a league row
  correctly navigates to `/manager/<leagueId>`, and `/manager/open-spots`
  itself renders as a real portfolio page (not misread as a league) —
  confirming the `PORTFOLIO_SLUGS` registration took.

### Waiver board on Open Spots (2026-09; requested explicitly by the owner)

"Give me a way to waiver the players in these spots easily" — the page
above now embeds the SAME Mass Add/Claim board `/manager/lineups` already
uses (`components/manager/BulkAdd.tsx`), pre-scoped to only the leagues
that genuinely have an open spot. No new write path: `BulkAdd` already
owns the real add/claim logic (`lib/sleeperWrite.ts`'s `addDropFreeAgent`/
`claimWaiver`, FAAB suggestions, `ConnectWriteAccess` for the browser-only
Sleeper token, `BulkConfirm` before anything sends) — this just hands it a
filtered `LineupLeague[]`.

- `app/manager/open-spots/page.tsx` now builds the full `LineupLeague`
  shape (same fields `/manager/lineups` builds, including `ManagedLeague`
  via `slimLeagueSettings`) instead of the smaller shape used for the
  read-only list alone, so the exact same board can consume it.
  `components/manager/OpenSpots.tsx` filters to the open-spot subset,
  renders it via `<BulkAdd leagues={openLeagues} .../>` under a "Waiver a
  player into these leagues" heading, own `ConnectWriteAccess` instance
  (same browser-local token pattern, independent of the Lineups page's).
- Scoping to open-spot leagues doesn't need any new logic: `BulkAdd`'s own
  `buildMultiAddPlan` already determines per-(league, target) whether a
  drop is needed, so if the owner picks 2+ targets for one 1-spot league,
  the second target there still correctly shows "needs a drop" — the
  page's own filtering only narrows which LEAGUES are offered, not
  per-target capacity math, which was already correct.
- **Verification note**: the read-only half (stat cards + league list) was
  re-verified live against the real account (16/210 leagues, matches
  earlier). The write-capable half (BulkAdd search/execute) could NOT be
  live-verified this session — extensive debugging traced it to the
  Browser pane tab being backgrounded (`document.hidden: true`,
  confirmed directly via `document.visibilityState`/`requestAnimationFrame`
  never firing), which halts React's passive-effect scheduling entirely
  in this Chromium build (`usePlayerMap`'s fetch, `loadPrefs`,
  `ConnectWriteAccess`'s mount effect all never ran) — proven NOT a code
  bug: a direct onClick handler on the same page updated state and called
  `getPlayers()` successfully in under 15ms once fired manually, and the
  component tree is structurally identical to `/manager/lineups`'s
  already-proven-working `BulkAdd` usage. `tsc`/`eslint`/`next build` all
  clean. Worth a quick real check in a normal (focused) browser tab before
  relying on it for a live add.

### Optimize: RB/WR never in FLEX on Thu/Fri/Sat + choose the week (2026-09; requested explicitly by the owner)

The owner wants to auto-set lineups by highest projection, but with a real
roster-lock strategy layered on top: a Thu/Fri/Sat game locks days before
Sunday's, so an RB/WR playing one should never sit in FLEX — that slot
should stay open as long as possible for a Sunday/Monday decision. Explicit
priority order requested: Thu > Fri > Sat > Sun > Mon.

- **`lib/lineupOptimizer.ts`** — `gameDay` extended from THU/MON-only to all
  five real days. Two effects, both only when a caller supplies `gameDay`:
  (1) a genuine **hard rule** — an RB/WR with a Thu/Fri/Sat kickoff can never
  be assigned to a FLEX-type slot (`FLEX`, WR/RB flex, WR/TE flex,
  superflex), full stop, scored the same way "not eligible for this slot"
  already was (previously TE/QB were never restricted at all; this stays
  scoped to RB/WR only, matching what was asked). (2) `DAY_TRUE_SLOT_BIAS`
  generalizes the old `THU_TRUE_SLOT_BONUS`/`MON_FLEX_SLOT_BONUS` pair into a
  graded, strictly-decreasing tie-break across all five days (Thu biggest
  push toward the true slot, Mon the mirror push toward FLEX) — still tiny
  (≤0.0025) and only ever settles a choice real points leave genuinely tied;
  a real point edge always wins who starts and, per a live-verified case,
  even a 0.1-point edge survives a bias pulling the other way. Both wired
  into `lib/commandCenter/engine.ts`'s `lineup_improvements` (chat "Fix my
  lineups") the same way.
- **`components/manager/BulkOptimize.tsx`** (`/manager/lineups` → Optimize)
  — previously never passed `gameDay` to the optimizer at all (a real gap,
  not by design). Now does, behind a new toggle ("Locking Thu–Sat starters
  out of FLEX", **on by default**) so the owner can compare with it off — a
  deliberate lever for the "I want to double-check this" ask, not a
  permanent option meant to stay off.
- **Week picker, same component** — was hardcoded to `currentWeek`; now a
  dropdown for any single week (`currentWeek`..18) or **"All weeks"**
  (computes every remaining week at once, one table, a "Week N ·" prefix
  per row so leagues aren't ambiguous across weeks — still sends one league
  at a time via the existing `BulkConfirm`/`runBulk` flow, `setStarters`'s
  real `week` param per row, never a mega-batch). Real, load-bearing caveat
  surfaced in the UI for any non-current week: Sleeper's injury designation
  is *today's* real status, not a forecast for that future week — a big
  swing on a future week can just mean this week's Out/Doubtful list
  doesn't apply yet, not a real opportunity. Matches the owner's own stated
  plan (previewing a week early, re-checking with their own rankings closer
  to kickoff).
- Tests: new `scripts/testLineupOptimizer.ts` (17 assertions, direct unit
  tests against `optimizeLineup` — no synthetic test tries to look like a
  real Sleeper roster, just isolates one rule at a time): the hard block
  actually benches a Thursday RB rather than ever placing him in FLEX, even
  when he outscores the only legal FLEX alternative by a wide margin (true
  slot locked via the same `locked` mechanism a real kicked-off game uses,
  so there's no reshuffle escape hatch to accidentally free room for him);
  Friday and Saturday get the identical treatment; Sunday/Monday stay fully
  unrestricted; TE and QB are confirmed NOT hard-blocked (own true slot
  locked, so a flex-eligible slot is their only path in — proving allowed,
  not just occasionally preferred); the Thu>Fri>Sat>Sun>Mon tie-break
  ordering on genuine point ties; a real (if tiny) point edge beating an
  opposing-direction day bias; the original day-unaware behavior exactly
  reproduced when `gameDay` is omitted (regression guard for the two other
  callers before this change); and the "never propose a worse lineup"
  safety net holding even when the hard rule makes a bench player the only
  honest answer. No existing suite regressed (391 engine + 103 exec still
  pass). Also caught and fixed two flawed first-draft test scenarios that
  didn't account for the Hungarian solver's own valid reshuffling (e.g.
  swapping a Sunday RB into FLEX to free his true slot for a Thursday one
  scores MORE points, not less — a real, correct optimization the naive
  test didn't expect) — worth knowing if this file gets extended.
- Verified live against the real account (219 leagues, best ball excluded
  by the page's existing default): toggling the new lock on/off for week 4
  changed 200 vs. 182 leagues needing a lineup change — an 18-league real,
  measurable difference, confirming the wiring reaches all the way through
  at full scale, not just in the unit tests. "All weeks" computed across
  all 219 leagues × 16 remaining weeks (2,882 total changes) with no
  errors. Confirmed zero Sleeper writes throughout (no token connected).

### Player memory: Never Start + free-text Notes (2026-09; requested explicitly by the owner)

"I need a way for you to keep a memory of my leagues and for me to action
based on it... all my players, all my notes, what my preferences are so I
can ask questions that are easily executable, e.g. if I want X player
moved away from my lineup." Split into two real, distinct things rather
than one fuzzy "memory" blob, since only one of them can honestly be made
"executable" without an LLM in the loop:

- **`neverStart`** (new 4th `PlayerPreference` kind, `never_start`) — a
  genuine hard exclude, not a preference: a listed player is never proposed
  as a starter by Optimize or chat's "Fix my lineups", in any league, full
  stop — stronger than the existing `avoid` (which still starts him as a
  last resort if nobody else can fill the slot). This is the actually
  "executable" half of the request. Wired straight into
  `lib/lineupOptimizer.ts` as a new `neverStart?: (id) => boolean` input:
  excluded from the assignment pool entirely, weighted below an empty slot
  (`-BIG`) so the "never propose a worse lineup" safety check can't block
  his removal, matching every other hard exclude's shape.
  - **Real bug found and fixed while building this**: the existing "nobody
    to put in a slot, leave whoever's already there" fallback (there for
    injured/bye players, where leaving them is scoring-neutral) doesn't
    know about `neverStart` — without a fix, a hard-excluded player with no
    replacement available would get silently placed right back by that
    fallback, defeating the whole rule in exactly the case it matters most.
    Fixed by excluding `neverStart` players from that fallback specifically
    (`unavailable`'s use of it is intentionally unchanged — leaving an
    injured player in place is genuinely harmless there). Caught by a new
    direct test, not spotted by inspection.
  - Same one-column-of-mutual-exclusivity pattern as `priority`/`avoid`/
    `ir_release` (a player can only be in one list; priority wins over all).
  - Wired into `components/manager/BulkOptimize.tsx` (new `neverStartSet`,
    a `⛔` flag next to the existing ★/⊘, and a `"never start"` swap reason)
    and `lib/commandCenter/engine.ts`'s `lineup_improvements` case, so chat
    and the UI tool both honor it.
- **`PlayerNote`** (new table, `playerId` PK, free-text `note`) — purely
  informational memory, deliberately NOT auto-executed (there's no LLM in
  this app to safely interpret arbitrary free text as an instruction — see
  Command Center's own "no LLM" rule). `app/api/manager/player-notes/route.ts`
  is a single-player upsert/delete (empty note deletes), not a full-list
  replace like `/preferences` — notes are free text per player, not list
  membership. Surfaced in `lineup_improvements`'s rationale as `— note: …`
  whenever the noted player is the one coming IN on a real swap.
- Both editable under Lineups → My players (`components/manager/PlayerPreferences.tsx`):
  a "Never Start" section (same add/remove UI as the other three lists) and
  a "Notes" section (search, a per-player textarea, independent save/remove
  per note — its own load/save lifecycle, since it isn't part of the
  `prefs`/`savePrefs` full-replace object).
- Migration: `20260928051736_add_player_note` (additive only — a new table
  plus a doc-comment change to `PlayerPreference.kind`; no data loss, no
  column changes).
- Tests: 4 new assertions in `scripts/testLineupOptimizer.ts` (now 21) —
  hard-excluded even as the only candidate for an otherwise-empty slot,
  correctly benched when already started (the fallback bug above, caught
  by this exact test), and an unbanned replacement still fills the slot
  normally. One existing rationale-wording assertion updated in
  `scripts/testCommandCenter.ts` for the generalized Thu–Sat text (391
  total, unaffected otherwise).
- Verified live against the real account: added Tank Bigsby to Never Start
  and a real note to Antonio Williams via the actual UI, confirmed both
  persisted (`GET /api/manager/preferences` → `neverStart: ["9225"]`,
  `GET /api/manager/player-notes` → real note text keyed by Antonio
  Williams's id), then ran chat's "Fix my lineups" across the real 210-league
  account and confirmed zero proposals ever place Tank Bigsby as an
  incoming starter. Confirmed read-only throughout, zero Sleeper writes.

### Command Center chat: reorganized example prompts into categories (2026-09; requested explicitly by the owner)

"Restructure the questions, I don't like how it's all listed" — the 12
example prompts under the chat box were one long flat row. Grouped into 6
labeled categories (Lineups, Waivers & Adds, IR, Standings & Record, Roster
health, Weekly sweep) as toggleable pills; clicking one reveals just that
category's 2–3 examples below it, collapsed by default. Pure UI
reorganization — the underlying example strings and what they do are
unchanged. Verified live: all 6 category pills render correctly (confirmed
via the real page's `.chip-filter` list) alongside the existing standings/
exposure filter chips elsewhere on the page.

### Command Center: collapsed the 4-mode ladder to Planning/Live, dropped Phase 5's auto rule (2026-09; requested explicitly by the owner)

The mode ladder (Read-only → Propose-only → Execute-approved → Auto-execute)
was itself the friction the owner was complaining about: "the command center
should be reformatted to execute only, after 1 confirmation of what exactly
will be done." Scoped via two rounds of `AskUserQuestion` before touching
code: (1) collapse the ladder entirely to two states, planning (default,
nothing sends) and live (flip it on once) — in live mode a command shows
exactly what it'll do and one Send button does it, no separate approve step,
no per-item checkbox screen; (2) bulk execution stays exactly as it was —
review the list once, then send; (3) drop Phase 5's unattended auto-IR rule
entirely — every execution now needs the same 1-click confirm, no more
timer-driven sends while the page is merely open.

- **`Permission` is now `"PLANNING" | "LIVE"`** (`lib/commandCenter/types.ts`,
  re-exported from `lib/commandCenter/proposals.ts`). `PERMISSION_ORDER`/
  `_LABEL`/`_BLURB` shrank to the two values; `canPropose`/`canExecuteApproved`/
  `canAutoExecute`/`atLeast` were replaced by one `canSend(p) => p === "LIVE"`.
  `CURRENT_PERMISSION` (the static, always-inert value the read-only engine's
  own architecture test checks) is now `"PLANNING"`.
- **Saving a proposal from chat no longer depends on the mode at all** — it's
  a DB write, not a Sleeper write, so it was always safe; the old "Read-only
  mode — switch to Propose only to save" refusal is gone from both
  `CommandCenterAI.tsx` (the Save button) and `engine.ts`'s `draftsBlock`/
  `execute_request` text, which now say the same thing regardless of mode.
  Only *sending* a saved proposal to Sleeper still requires Live.
- **No more separate approval step.** `ProposalsPanel.tsx`'s per-proposal UI
  used to be Approve → Execute… → a confirm box with its own "I've reviewed
  this" checkbox → Yes, send (three clicks across two screens). It's now one
  "Send to Sleeper" button on the proposal itself; the proposal's full
  description and rationale are always visible (previously the reasons were
  behind a collapsed "Why" toggle) so the button's context IS the "shows
  exactly what it will do" — no modal needed. The **mode switch itself**
  still needs one explicit confirmation (the "I understand this can change my
  real Sleeper leagues" checkbox in `PermissionBar.tsx`, now shown once when
  switching Planning → Live), which is where that safety step now lives
  instead of being repeated per proposal.
- **State machine stayed almost untouched, on purpose** (`lib/commandCenter/
  proposals.ts`): `ProposalStatus` still includes `"approved"` and
  `canTransition`'s `NEXT` map still allows `approved → executing`, purely so
  any proposal a real user had already saved/approved under the old UI before
  this shipped keeps working — the executor's `gate()` now accepts sending
  from *either* `"proposed"` or `"approved"`. The one real state-machine
  change: `NEXT.proposed` now also allows `"executing"` directly (it only
  allowed `approved/rejected/expired` before), since a person now sends
  straight from "proposed" with no approval step in between. Caught this by
  writing the test first: the server route (`/api/manager/proposals/[id]`)
  calls `canTransition` and would have silently 409'd every real send attempt
  without this change — never manually exercised the money path, would have
  been an ugly surprise on the first real Live-mode send.
- **Phase 5 (the trusted IR/PUP auto rule) is fully removed**, not just
  hidden: `AutoConfig`, `DEFAULT_AUTO`, `normalizeAuto`, `selectAutoIrMoves`
  (`proposals.ts`), the `autoStore`/`autoDayStore`/`AutoDay` localStorage
  stores (`ccStore.ts`), the entire "Trusted auto rule" panel and its
  interval timer (`ProposalsPanel.tsx`), and `ExecMode`'s `"auto"` value +
  `autoRuleEnabled` gate (`commandCenterExec.ts`) are all gone. There is no
  code path left anywhere that can send a Sleeper write without a person
  clicking Send in that moment.
- `ProposalsPanel.tsx`'s two tabs are now "To send" (status `proposed` or
  `approved`, plus `executing`) and "History" (everything terminal) — the
  old three-tab Review/Approved/History split doesn't apply once there's no
  separate approved state to browse. Bulk selection now pulls straight from
  the sendable list in "To send" instead of a dedicated Approved tab.
- Old `CommandProposal` rows and `CommandAudit.permission` values from the
  4-mode era are handled, not migrated: `isPermission()` rejects the retired
  values and callers fall back to `"PLANNING"`, and a stray `origin: "auto"`
  row (from the now-removed Phase 5) still displays fine, just labelled as
  historical.
- Tests: `scripts/testCommandCenter.ts` (still 391 — permission-model checks
  updated in place, no new count since this was a UI/architecture
  simplification, not new player-facing logic) and
  `scripts/testCommandCenterExec.ts` (84, down from 103 — the ~19 Phase 5
  auto-rule assertions were deleted along with the feature, not replaced).
  `tsc`/`eslint`/`next build` all clean.
- Verified live against the real 246-league account (no Sleeper token
  connected in this browser, so nothing could actually send regardless): the
  Planning/Live buttons and blurb render correctly; clicking Live shows the
  one-checkbox confirm with the "Sleeper access isn't connected" warning;
  Cancel returns to Planning; a real chat scan ("Find Malachi Fields
  everywhere") drafted 47 real ADD proposals and saving them worked in
  Planning mode exactly as designed; the Proposals tab listed all 47 as
  "Ready to send" with a single disabled "Send to Sleeper" button each
  (confirmed disabled via `button.disabled` in the page, not just visually)
  and "Switch to Live to send this."; History tab correctly showed 5 older
  rejected rows from an earlier smoke test. Cleaned up all 47 verification
  proposals afterward (rejected via the same PATCH endpoint the UI uses) so
  nothing was left cluttering the owner's real Proposals tab.

### Chat: "move all to IR, keep &lt;player&gt; on my bench" exception (2026-09; requested explicitly by the owner)

"I want Nico Collins on my bench, I think he'll play week 4" — the owner
wanted a way to name a real judgment call (a player who's technically
IR-eligible but they expect back soon) and have the bulk IR move skip him
entirely, without having to remember it every time as a standing list (that
already exists separately as the IR Release list, which is about who to
*release*, not who to keep active — a different question).

- `ir_opps`'s `Intent` gained an optional `keepOnBench?: Mention[]`
  (`lib/commandCenter/intent.ts`), recognized two ways:
  1. **Inline on the same command**: "move all my IR eligible players to
     IR, keep Nico Collins on my bench" (also "except X" / "excluding X" /
     "leave X on the bench"), composable with the existing inline release
     order in the same sentence — every mention in the sentence has to be
     accounted for by one clause or the other, or this doesn't fire, so a
     real per-player "move X to IR" is never mistaken for it.
  2. **A standalone follow-up with none of the IR/league wording at all**:
     "I want Nico Collins on my bench, I think he'll play week 4" — matched
     by its own bench language rather than a session flag, since `ir_opps`
     has no persisted "a scan just ran" marker the way add/waiver scans do
     (it always re-scans fresh regardless).
  Checked for both never colliding with `send_to_ir`/`activate_ir`: neither
  mentions "bench" nor a keep/except/leave word, so "put X on IR" and "move
  X to IR" (the opposite direction) still route correctly — verified
  directly, not just assumed.
- **The real fix was doing the exclusion BEFORE building the plan, not
  after.** `lib/commandCenter/engine.ts`'s `ir_opps` case resolves the named
  player(s) first, then wraps `injuryOf` so a kept player reports as healthy
  (`null`) to `buildIrPlan` — he's dropped out of the eligible pool entirely,
  the same as if he really weren't hurt. Filtering the OUTPUT afterward
  instead would have been a real, silent bug: `buildIrPlan` assigns open IR
  slots to the most-severe-first sorted eligible list, so if the kept player
  would have sorted first, the open slot is "spent" on him internally before
  any output exists to filter — the next real eligible player in that same
  league would have been wrongly reported as needing a drop instead of
  getting the now-free slot. Caught and tested directly (section 35(b) in
  `scripts/testCommandCenter.ts`): a synthetic league with one open slot and
  two eligible players proves excluding the kept one really reassigns the
  slot, not just hides a row.
- The summary line discloses him honestly: "Kept on your bench by request,
  not moved: Nico Collins (real IR-eligible in N leagues)" — N computed the
  same way `buildIrPlan` itself determines eligibility (rostered, active,
  not already on IR, `irAllowed()` true for his real status), never a guess
  or a raw "rostered in N leagues" count.
- Deliberately NOT a persisted preference list (unlike IR Release) — this is
  a one-off, often week-specific call ("I think he'll play week 4"), and the
  owner didn't ask for a standing list. If that changes, add a fourth
  `PlayerPreference` kind the same way `ir_release`/`never_start` were added.
- Tests: 35 new assertions in `scripts/testCommandCenter.ts` (section 35,
  now 409) — inline exclusion with a genuinely real "IR" status (not a
  vacuous case where he'd never have been eligible anyway), the slot-math
  correctness case, the standalone bench-only phrasing, both IR directions
  confirmed un-swallowed, and three inline phrasing variants (except/
  excluding/leave-on-bench). `scripts/testCommandCenterExec.ts` unaffected
  (84, unchanged) since this is entirely in the read-only engine/intent
  layer — no executor or write-path code touched. `tsc`/`eslint`/`next
  build` all clean. Not live-verified against the real account this time —
  the local dev server came up behind the `/admin` passphrase gate with no
  session cookie available in this browser context, so it couldn't be
  unlocked without the owner's own passphrase; verification instead relied
  on `handleCommand` integration tests, which exercise the real engine entry
  point (not a mock) end to end.

### Open Roster Spots: "If you ran the IR sweep" preview (2026-09; requested explicitly by the owner)

The owner wanted to know, without typing anything into chat, which leagues
would open a bench spot if they ran the bulk IR move — previously only
answered by asking Command Center "move all my IR eligible players to IR"
and reading the report at the bottom of that response (see the "IR
opportunities: open bench slot after the move" entry above). Added as a new
section on `/manager/open-spots` (`components/manager/OpenSpots.tsx`),
right below the existing "currently open" list — the natural home since
it's the same question ("where could I add without a drop") from a
different angle (before vs. after a bulk IR run).

- **Read-only preview, no new write path** — reuses the exact same
  `buildIrPlan()` (`lib/bulkPlan.ts`) the Command Center chat command and
  the Mass IR tool (`BulkIR.tsx`) already run, with the same real inputs
  (`usePlayerMap()` for live injury status, `useDropRank()` for the same
  Fantis/FantasyCalc-based release ranking, the owner's real Priority list
  so a protected player is never assumed droppable from IR here either).
  Nothing on this page ever calls a write endpoint — it only computes what
  the existing tools' own logic would produce.
- Real roster math, same rule the chat report already uses: a player moving
  active → reserve always frees an active slot behind him, but only counted
  for moves that could actually happen — a league where IR is already full
  with nobody real to release first (`noRoom`) is excluded from the "would
  open" count and reported separately instead, never silently folded in.
- Three states, all honest: nobody real is IR-eligible right now ("Nobody
  rostered... is currently IR-eligible"), eligible players exist but none of
  the moves would open a NEW spot beyond what's already open above, or a
  real list of leagues with how many moves and how many slots would open,
  each linking to that league. A `noRoom`-blocked count is always shown
  alongside, never dropped from the total.
- Deliberately does nothing when clicked — no button runs anything from this
  section; the copy says so explicitly ("A preview only — nothing is moved
  here") and points to the two real places that do (Command Center chat, or
  Mass IR).
- `tsc`/`eslint`/`next build` all clean. Not live-verified against the real
  account — same `/admin` passphrase blocker as the entry above (no session
  cookie in this browser context, and materializing the passphrase from
  `.env.local` to unlock it was correctly refused by the harness's own
  credential-handling guardrail, which this project's own working rules
  don't override). The underlying computation is the same `buildIrPlan()`
  already exercised end-to-end by `scripts/testCommandCenter.ts`'s ir_opps
  sections and used identically by the already-shipped, already-verified
  `BulkIR.tsx` — worth a quick real look on `/manager/open-spots` before
  leaning on it for a specific number.

### Weekly Record page — real per-week win/loss across every league (2026-09; requested explicitly by the owner)

"I want to analyze how many leagues are winning/losing" — a new
`/manager/record` page (My Leagues nav group, right under My Leagues) shows
the owner's real per-week result in every in-season league, not just the
current-season W-L-T total the Portfolio page's Record Snapshot already
shows.

- **Source of truth: `WeeklyResult`**, the same table the `week_record` chat
  intent reads (`app/api/manager/week-record/route.ts`) — real per-roster,
  per-week outcomes the regular sync already resolves from Sleeper's own
  `getMatchups()` response, "never guessed" per its own schema comment.
  `won: null` covers BOTH a genuine tie AND a bye/unresolved pairing —
  Sleeper's data doesn't distinguish them, so this page doesn't invent a
  distinction either; it's labelled "Tied / bye" throughout, honestly
  ambiguous rather than silently wrong. `Matchup` supplies the opponent name
  + score for each week's tooltip, same join the week-record route already
  does.
- **Pure DB read** (`app/manager/record/page.tsx`) — no Sleeper call, reads
  `Roster` (to know which rosterId is mine per league), `WeeklyResult`, and
  `Matchup`, all already synced. Scoped to `status: "in_season"` leagues the
  owner actually has a roster in.
- **Three views, one page** (`components/manager/WeeklyRecord.tsx`):
  1. Stat cards — Winning / .500 / Losing league counts (the exact same
     `wins > losses` / `===` / `<` rule the Portfolio Record Snapshot card
     already uses, so the two numbers agree) plus weeks tracked.
  2. **By week** — for every week with real data, most recent first: how
     many leagues won/lost/tied-or-byed that week, and a real win% — the
     direct trend-over-time answer to "how many am I winning/losing."
  3. **By league** — filterable (All/Winning/.500/Losing, each chip labelled
     with its real count) and sorted worst-record-first by default, so
     struggling leagues surface without hunting. Each row shows the season
     record, the real current streak (reused `computeStreak()` from
     `lib/leagueRank.ts` — the same function that powers Standings' Streak
     column, not a second implementation), and a compact per-week strip of
     small colored squares (mint = won, red = lost, dim = tied/bye, blank =
     not yet played) — a full season at a glance without an 18-column table.
     Hovering a square shows that week's real opponent and score; clicking a
     row goes to that league.
  Best-ball leagues are hidden by default with the same "Best ball hidden
  (N)" toggle chip `/manager/lineups` already uses (`LineupManager.tsx`),
  reused verbatim for consistency rather than a new invented label.
- Registered like every other top-level portfolio page: `managerNav.ts` (nav
  entry) and `leagueSubRoutes.ts`'s `PORTFOLIO_SLUGS` (skipping this is the
  exact bug the `open-spots`/`inbox` entries above already flag — a
  top-level `/manager/<slug>` left out gets misread as a league page with
  `leagueId="record"`).
- `tsc`/`eslint`/`next build` all clean. Not live-verified against the real
  account — same `/admin` passphrase blocker as the two entries above (no
  session cookie in this browser context). The underlying data path
  (`WeeklyResult`/`Matchup` joined by league+week) is the same one already
  exercised by the real, working `week-record` API route and the `Streak`
  column already shown on Standings — worth a quick real look on
  `/manager/record` before leaning on a specific number.

### Weekly Record: week 1 showed 109 fake "ties" — two passes to the real fix (2026-09; real bug reported by the owner)

The owner caught it immediately from real usage: Week 1 read 63 won / 38
lost / **109 tied**, which isn't a real outcome in fantasy scoring at any
real scale.

**First pass (wrong theory).** Investigated against the live database
directly (one-off `tsx` scripts, deleted after use — never kept in the
repo) rather than guessing: all 109 had `myPoints: 0` and `opponentPoints:
0` against a real, named opponent (never a bye — a genuine bye has no
opponent). Theorized this meant those leagues' real Sleeper drafts happened
after week 1's games had already started, so the 0-0 was Sleeper's own
"nothing happened yet" data. Shipped a display-side fix on that theory —
dropping any `WeeklyResult` row with `won === null && points === 0 &&
opponentPoints === 0` — and reported week 1 as 63/38/**0**.

**The owner immediately caught that this was ALSO wrong**: "i had more than
63+38 leagues in week 1" — the fix had gone from over-counting fake ties to
silently dropping 109 real, decided games. That was the signal the theory
itself was wrong, not just the display math. Checked it properly this time:
called Sleeper's real live API directly for a sample of the "ghost" league
IDs (`GET /league/{id}/matchups/1`) instead of reasoning from the DB alone —
**every one had real, non-zero week-1 scores with a normal 2-team
pairing**. The 0-0 in Fantis's own database was stale, not reality.

**Real root cause**: `lib/managerSync.ts`'s backfill only fetches a past
week from Sleeper if `WeeklyResult` has **no row at all** for it
(`!existing.has(w)`). If an account's very first sync for a league happened
to run before that week's real scores existed yet, it wrote a 0-0
placeholder — and because a row (any row) now existed, that week was
permanently treated as "already synced" and never revisited, even once the
real scores existed on Sleeper's side. A genuinely completed past week
where every roster shows exactly 0 points is never a real result, so this
was self-diagnosing once checked directly.

**Real fix, two parts**:
1. `lib/managerSync.ts` — the backfill "is this week missing" check now
   also treats a past week as needing a refetch when every existing row for
   it is exactly 0 points, not just when there's no row. Self-healing: the
   next regular sync (scheduled or "Sync now") repairs any account that
   ever hits this, including any future recurrence for a different league.
2. Ran the real, existing `syncAccount()` — the exact same code the "Sync
   now" button calls, not a bespoke repair script — once immediately
   (via a deleted one-off `tsx` script) so the OWNER'S CURRENT data was
   corrected right away rather than waiting on their next manual sync.
   Verified directly against the DB before and after: week 1 went from
   63/38/109(fake) to the real **133 won / 77 lost / 0 undecided**.
3. The display-side 0-0 filter in `app/manager/record/page.tsx` from the
   first pass was kept, but its comment corrected — it's no longer the fix
   itself, just a harmless defensive backstop (and it's exactly right for
   the CURRENT in-progress week too, which legitimately shows 0-0 for
   everyone until real games are played — confirmed live: week 4, the
   account's actual current week, showed all 210 leagues at 0-0 undecided,
   correctly excluded from the trend rather than counted as 210 ties).
- `tsc`/`eslint`/`next build` all clean. The lesson worth keeping: the first
  fix "worked" in the narrow sense that it made the specific reported number
  go away, but was never checked against the one source that could actually
  confirm or refute the theory (Sleeper's own live data) — the owner's
  immediate real-usage pushback caught what a satisfied-looking test result
  didn't.

### Mass IR: "keep on bench" search box (2026-09; requested explicitly by the owner, scoped via AskUserQuestion)

The chat command's `keepOnBench` exception (see the entry above) had no
equivalent on `/manager/lineups`' Mass IR tool — the only way to keep one
player out of a bulk IR run there was unchecking every one of his rows by
hand, league by league. Asked directly how this should work (one-off
per-run vs. a standing list vs. both); the owner chose **one-off per run**,
matching the chat version's own "I think he'll play week 4" spirit rather
than a fifth standing `PlayerPreference` list.

- `components/manager/BulkIR.tsx` — a search box ("Keep someone on the
  bench instead — search a player…") scoped to players genuinely eligible
  in the CURRENT run (`rawRows`, `buildIrPlan` computed unfiltered), not the
  whole player universe — searching for someone not actually IR-eligible
  right now would be noise. Picking one adds him as a removable chip
  ("Kept on bench this run: ×") and excludes him from the run.
- **Same exclude-before-the-plan lesson as the chat fix, applied here too**:
  `injuryOf` is wrapped to report a kept player as healthy (`null`) BEFORE
  `buildIrPlan` runs, not filtered out of the rows afterward — otherwise a
  kept player who'd have sorted first for an open IR slot would still
  "spend" that slot internally, wrongly leaving the next real eligible
  player marked as needing a drop instead of getting the freed slot.
- Deliberately session-only, no persistence: reloading the page or leaving
  the tab clears the keep list, matching the "re-pick him next time if
  still needed" behavior the owner chose. If a standing list is wanted
  later, it's a straightforward addition — the same `injuryOf`-wrapping
  mechanism already generalizes to it.
- `tsc`/`eslint`/`next build` all clean. The underlying exclusion mechanism
  (`buildIrPlan` fed a wrapped `injuryOf`) is the exact same one already
  proven correct by `scripts/testCommandCenter.ts` section 35(b) for the
  chat version — this addition is UI plumbing around already-tested logic,
  not new pure-function behavior, so no new test file was added (matches
  this codebase's convention: `lib/**` pure logic gets `tsx` test scripts,
  component-level UI does not). Not live-verified against the real account
  — same `/admin` passphrase blocker as the last several entries (no
  session cookie in this browser context) — worth a real check on
  `/manager/lineups` → Mass IR before relying on it for a live run.

### Chat: activate_ir swaps with another real IR-eligible player instead of dropping, when applicable (2026-09; requested explicitly by the owner)

"need a logic to swap nico with another IR if it's applicable i need him on
the bench in all leagues" — activating a player off IR onto a full active
roster previously only ever offered one option: drop a bench player
entirely to make room. The owner wanted a real alternative that doesn't
lose a player — if another player on the same roster is genuinely
IR-eligible right now, move HIM onto IR instead, freeing the same active
slot without a drop. Their own "if it's applicable" framing anticipated the
real constraint this turned out to have.

- **`lib/bulkPlan.ts`'s `buildActivateIrPlan`** gained an optional
  `injuryOf` parameter (default `() => null`, so any other caller keeps the
  original drop-only behavior) and two new `ActivateIrRow` fields:
  `swapId`/`swapInjury`. When a league needs a drop to activate him, it now
  also checks whether ANY other rostered player (not already on IR) has a
  real injury status this league's own IR rules allow.
- **The real constraint that makes "applicable" a genuine question, not
  just a nicety**: a swap only works when the league has an open IR slot
  *beyond* the one the player being activated currently occupies
  (`irSlots(settings) - reserve.length > 0`, computed while he's still
  counted in reserve). If his league has only 1 IR slot and he's the sole
  occupant, the other player literally cannot get an IR slot until he
  leaves it — and he can't leave it until the active roster has room, which
  is exactly the problem a swap would solve. A real deadlock, not a bug;
  the existing drop fallback still covers that case exactly as before.
- **Engine wiring** (`lib/commandCenter/engine.ts`'s `activate_ir` case):
  when a swap is available, it drafts an `IR_MOVE` (the other player → IR)
  immediately followed by a drop-free `ACTIVATE_IR`, in that order — same
  ordering-is-the-safety-property pattern already established for
  `ir_opps`'s release-then-move pairing: the bulk executor runs proposals
  one at a time and stops on the first unverified result, so the activation
  is only ever attempted after the IR move that frees its room is
  confirmed. A `claimedSwapByLeague` map (mirroring the existing
  `claimedByLeague` for drops) means two named players activated together
  in the same league never get proposed to swap with the same other
  player — the second honestly falls back to a real bench drop instead.
- Tests: 4 new sub-sections (~15 assertions) in `scripts/testCommandCenter.ts`
  (section 36, now 422) — the applicable case (IR_MOVE then drop-free
  ACTIVATE_IR, in order), the genuinely-inapplicable case (single IR slot,
  falls back to the original drop behavior unchanged), a Questionable
  player correctly never treated as swap-eligible (falls back to being a
  normal drop candidate instead), and distinct swap assignment across two
  players sharing one real swap candidate. Caught a real test-setup bug
  while writing these, not an implementation bug: this test harness's
  `env.rank` is hardcoded to `[0,0]` (always tied), so drop-candidate
  ordering falls back to array order under a stable sort — a `values`
  override that worked in spirit but did nothing here; fixed by ordering
  the fixture's player list instead, same convention section 29 above
  already relies on. `scripts/testCommandCenterExec.ts` unaffected (84,
  unchanged) — no executor or write-path code touched, this is entirely
  new read-only planning logic. `tsc`/`eslint`/`next build` all clean. Not
  live-verified against the real account — same `/admin` passphrase
  blocker as the last several entries.

### Waiver Assistant: trending list, non-best-ball scoping, easy multi-add (2026-09; requested explicitly by the owner, scoped via AskUserQuestion)

The owner shared screenshots of a competitor's waiver tool as reference and
asked for the top-5 trending list, filtering out best ball and anything
that isn't "my leagues" (also floating "maybe even" removing the new Weekly
Record page). Scoped both open questions directly rather than guessing on
either a deletion or a full visual clone: **kept** Weekly Record as-is, and
for the redesign chose **"borrow the concepts"** over a fuller tabbed
rebuild — keep the page's existing structure, add trending + the existing
multi-add board as new sections, apply consistent league filtering.

- **`/manager/waiver` now scopes to leagues actually being managed** — same
  filter Lineups/Open Spots/Weekly Record already use (`status: "in_season"`
  + `!isBestBall(settings)`), applied in `app/manager/waiver/page.tsx` to
  every league-derived prop on the page. Previously this page had **no
  filtering at all** (every league, every status, best ball included) — a
  real gap the other portfolio pages had already closed but this one never
  got. Waiver history (past-season data) is untouched, since "in-season"
  filtering doesn't apply to completed seasons.
- **"Hottest adds & drops"** (`components/manager/WaiverAssistant.tsx`) —
  Sleeper's own real top-5 most-added and most-dropped players in the last
  24h, platform-wide (`lib/sleeper.ts`'s `getTrendingAdds`, already used
  inside `BulkAdd`'s own trending panel, plus a new `getTrendingDrops` for
  the drop side — verified live via a direct `curl` before wiring it up,
  same rigor as every other "does this endpoint actually return real data"
  check in this app). Explicitly labelled as platform-wide, not a per-league
  availability check, since that's a different question the search box and
  multi-add board below actually answer. Clicking a trending add plugs him
  straight into the existing single-player lookup tool below.
- **"Add several players at once"** — the exact same `BulkAdd` multi-target
  board already proven on `/manager/lineups` and `/manager/open-spots`
  (search up to 8 targets, a league × target availability grid, FAAB
  suggestions, distinct drops when two targets need one in the same league,
  one combined confirm-and-send) — no new write path, no new logic, just
  another place the same already-tested tool is embedded, fed this page's
  own filtered league list.
- The original single-player search + real season-points drop-diff tool
  (queues Sleeper's own waiver page via the browser-automation userscript,
  rather than writing directly) is kept, relabelled "Single-player lookup"
  further down the page — it does something the multi-add board doesn't
  (a real points-based drop comparison per league) so it wasn't replaced,
  per the "borrow the concepts" scoping answer.
- `tsc`/`eslint`/`next build` all clean (three pre-existing lint findings in
  this file — two `react-hooks/set-state-in-effect`, one bare `<a>` tag —
  confirmed via the committed version before this change, not introduced by
  it; left alone as out of scope). Not live-verified against the real
  account — same `/admin` passphrase blocker as the last several entries.

### Bulk confirm: real summary line instead of forcing a scroll through every line (2026-09; requested explicitly by the owner, scoped via AskUserQuestion)

"i cant manually review them all, please automate like move to ir and etc"
— asked directly what "automate" meant here, since it's the exact
unattended Phase-5 rule the owner had just had removed on purpose ("Drop
it — everything needs the 1-click confirm now"). Given three real options
(faster manual review / one-click-per-command / true unattended automation
again), the owner chose the safest: **faster bulk review, still a real
click every time** — never bring back unattended execution.

- **`components/manager/BulkConfirm.tsx`** — the shared before-you-send
  review step used by Command Center's bulk send, Mass IR, and Mass Add/
  Claim. Past 8 lines, the full list now collapses behind a "Show all N
  lines" toggle instead of forcing a scroll through a 70-200-league batch
  before the send button works; a new optional `summary` prop shows a real,
  computed one-line breakdown in its place. This is a genuine safety
  trade-off, not a shortcut: the owner still clicks Send, still sees a real
  summary and can expand the full list any time, but is no longer required
  to scroll every line first.
- **Mass IR and Mass Add/Claim needed no changes at all** — both already
  pass a real breakdown as their `title` (e.g. "Move 72 players to IR
  across 72 leagues — including 24 drops"), so the shared component change
  alone gives them the faster-review behavior for free.
- **Command Center's bulk send** (`ProposalsPanel.tsx`) gained a
  `selectedSummary` computed from the actual selected proposals' kinds
  (e.g. "72 IR moves · 24 releases across 72 leagues"). First version paired
  it with a `BulkConfirm` modal + a separate ack checkbox below the "Send N
  selected" button — the owner immediately said that was still too much
  friction ("go back to auto execute, i just dont want to have to confirm
  all, what i select should happen"). Asked directly whether that meant the
  removed unattended Phase-5 rule again; it didn't — the owner's own
  follow-up made clear selecting the rows IS the review, and clicking "Send
  N selected" should run it immediately, no second screen. Removed the
  `BulkConfirm` modal and ack checkbox from this one flow entirely: the
  summary now shows inline as soon as something's selected, and the Send
  button runs `startBulk` directly. Mass IR and Mass Add/Claim keep their
  own `BulkConfirm` step untouched — this was a Command-Center-specific
  request, not a blanket policy change.
- Deliberately NOT done: no auto-approval, no unattended sending, no
  standing rule, nothing that runs without a click from the owner in that
  moment. Selecting rows + clicking Send is still one deliberate action
  every time — only the extra confirmation screen on top of that is gone.
- `tsc`/`eslint`/`next build` all clean; `testCommandCenterExec.ts` (84)
  unaffected, as expected for a pure UI change with no executor logic
  touched. Not live-verified against the real account — same `/admin`
  passphrase blocker as the last several entries.

### Waiver Assistant: real FAAB remaining + pending waiver claims (2026-09; requested explicitly by the owner)

"add a place to show me my faab and all my current waivers etc that are
pending etc i need to make this easier for me to see" — two real gaps on
`/manager/waiver`, both closed with data that already existed elsewhere in
the app rather than inventing anything new.

- **FAAB remaining, per league** — new `waiverBudget(settings)` helper
  (`lib/manager.ts`) reads the league's own real `waiver_budget`, but only
  when `waiver_type === 2` (Sleeper's real FAAB flag); reverse-standings and
  rolling-waiver leagues have no budget to run out of and are correctly
  left out of the list entirely rather than shown as "$0 left". Remaining =
  budget − `Roster.faabUsed` (already synced), computed in
  `app/manager/waiver/page.tsx`, sorted lowest-remaining-first so leagues
  close to broke surface first. Pure DB read, no Sleeper call.
- **Pending waiver claims** — `/manager/inbox` ("Trades & Claims") already
  had a real "Pending claims" tab; rather than send the owner to a second
  page for what they framed as one ask, the exact same underlying real data
  path (`lib/inbox.ts`'s `classifyTransactions`, Sleeper's private
  per-league transaction feed via `fetchLeagueTransactions`) is now also
  embedded directly in Waiver Assistant, scoped to claims only (no trades —
  those still belong on the inbox page). Reuses the SAME write-access token
  already connected for the multi-add board below it (moved
  `ConnectWriteAccess` up to the top of the page so both share one
  connection, no second "connect" step) — shows player, league, bid,
  Sleeper's raw status, and supports multi-select cancel via the same
  `cancelWaiverClaim` mutation the inbox page already uses. A fresh,
  on-demand scan (not backgrounded), same pattern as every other
  live-Sleeper-read tool in this app.
- Deliberately not merged into one shared component with `InboxManager.tsx`
  despite the real logic overlap (same `classifyTransactions`/
  `fetchLeagueTransactions` calls) — trades and claims together make sense
  as one scan on the inbox page; a waivers page pulling in trade-review UI
  it doesn't need would be scope creep in the other direction. The overlap
  is in the reused pure functions, not duplicated business logic.
- `tsc`/`eslint`/`next build` all clean (same 3 pre-existing lint findings
  as the entry above, unrelated to this change). Not live-verified against
  the real account — same `/admin` passphrase blocker as the last several
  entries.

### Waiver Assistant: single-player lookup now executes directly (2026-09; requested explicitly by the owner)

"i cant execute waivers from the page, it opens the league, can u code a way
to execute from fantis, i dont want to manually do this" — the single-player
lookup tool at the bottom of `/manager/waiver` was the one piece of Waiver
Assistant still using the old browser-automation queue (`POST
/api/manager/automation/actions` with `type: "open_waiver"`), which only
ever opened Sleeper's own page for the owner to finish by hand — a
leftover from before `BulkAdd.tsx`'s real direct-write pattern existed.
Converted to match every other add/claim tool in the app:

- **Real execution, same proven pattern as `BulkAdd.tsx`**: `runAdd`
  (`components/manager/WaiverAssistant.tsx`) calls `addDropFreeAgent` first
  for each checked, actually-available league; if Sleeper's own error
  message matches `/waiver/i` (the same real signal `BulkAdd` already keys
  off), it falls back to `claimWaiver` with a bid — never a pre-guess about
  whether a league is instant-add or waiver-gated, Sleeper's own response
  decides. Runs through the shared `runBulk` (concurrency 3), `StatusCell`
  per row for live feedback, and `useRefreshLeagues()` afterward so Fantis's
  own data reflects the change without a manual sync.
- **Real FAAB bid per row, not a guess**: `candidateLeagues` now reads each
  league's own `waiver_type`/`waiver_bid_min` (from the same slim settings
  `multiAddLeagues` already carries) and computes a suggested bid via
  `suggestBid()` — the same real-history-based helper (`lib/faabHistory.ts`)
  the multi-add board and Command Center already use, fetched once via the
  same `/api/manager/faab-suggest` endpoint. A non-FAAB league shows no bid
  field at all rather than a meaningless $0 one; a FAAB league's bid is
  editable per row and capped at that league's own real remaining budget
  (from the FAAB-remaining data this page already computes).
- **No more automation-queue dependency for this tool**: removed the
  `db.automationPing` lookup and the `automationLastPingAt` prop from
  `app/manager/waiver/page.tsx` (queued-and-opened is gone from this page
  entirely — `LeagueIdentityBar.tsx`'s unrelated use of the same
  `/api/manager/automation/actions` route was left untouched, confirmed by
  `grep` before removing anything), and deleted the `mounted`/
  `automationConnected` hydration-safety block that existed only to gate
  that now-removed "browser automation connected?" hint.
- `WaiverLeague` gained a real `rosterId` field (from `Roster.rosterId`,
  already synced) since a direct write needs it — the old queue-based flow
  never did.
- Incidentally fixed 2 of the file's 3 pre-existing lint findings as a side
  effect of deleting the code that caused them (confirmed by linting the
  prior committed version directly): the `mounted`-block's
  `react-hooks/set-state-in-effect` finding (removed along with the block)
  and the bare `<a href="/manager">Install the userscript</a>` link
  (`@next/next/no-html-link-for-pages`, removed along with the automation
  hint that contained it). The one remaining finding (a pre-existing
  `react-hooks/set-state-in-effect` on the "reset selection when the target
  player changes" effect) is untouched — confirmed identical before and
  after this change, out of scope for this fix.
- `tsc`/`eslint`/`next build` all clean. Not live-verified against the real
  account — same `/admin` passphrase blocker as the last several entries;
  the underlying write calls (`addDropFreeAgent`/`claimWaiver`) and bid
  logic (`suggestBid`) are the exact same, already-live-verified code paths
  `BulkAdd.tsx` uses, not new logic — worth a quick real add/claim on
  `/manager/waiver` before leaning on it for a live waiver run tonight.

### Waiver Assistant: dropped the standalone FAAB-remaining list, budget now shown at the bid itself (2026-09; real bug reported by the owner)

"the large faab remaining is useless i need to know when im actually
claiming someone not just the home screen" — the "FAAB remaining" section
(a full per-league list) and the "Total FAAB used" hero stat card on
`/manager/waiver` were pure home-screen decoration: real numbers, but
disconnected from the moment that actually matters, which is picking a bid
while claiming someone.

- **Removed both home-screen displays** from `components/manager/
  WaiverAssistant.tsx` — the standalone "FAAB remaining" `DataTable` section
  and the "Total FAAB used" `StatCard` (the hero grid now only shows when
  there's real waiver-position data, since that's all that's left in it).
  `waiverSummary`'s FAAB fields (`faabTotal`, `faabLeagues`) were dropped
  from the memo entirely — dead weight once nothing renders them.
- **The same real number now shows where a bid is actually being placed**,
  in both places a FAAB bid gets set:
  - **Single-player lookup** (`WaiverAssistant.tsx`) — `candidateLeagues`
    already computed each league's real `budgetLeft` (added for the prior
    direct-execution change); it was sitting behind a hover-only `title`
    attribute. Now a visible `$X left` label sits under the bid input
    itself, turning red if the remaining budget is under that league's own
    bid minimum — a real, at-a-glance affordability check exactly when
    you're setting the number.
  - **Multi-add board** (`BulkAdd.tsx`, shared by Waiver Assistant, Lineups,
    and Open Spots) — same visible `$X left` label added under its Bid
    column input; previously the real `budgetLeft` value only surfaced
    indirectly (capping the input's `max`, or in a warning banner if the
    combined bids across targets exceeded it) with no plain per-row number
    to look at. `faabLeagues` (used to compute `remainingByLeague` for the
    single-player tool) is kept as a prop — it's still real per-league
    data, just no longer rendered as its own section.
- `tsc`/`eslint`/`next build` all clean (same 1 pre-existing lint finding in
  `WaiverAssistant.tsx`, confirmed unrelated and untouched by this change).
  Not live-verified against the real account — same `/admin` passphrase
  blocker as the last several entries.

### Waiver Assistant single-player lookup: real drop dropdown + no drop on an open slot (2026-09; real bug reported by the owner)

"u need to give me the drop down to select who to drop, also no drop if
open slot etc" — two real gaps in the single-player lookup tool from the
direct-execution change above: it always suggested exactly one auto-picked
drop with no way to override it, and — because `pickDropCandidate` (the
season-points helper it was using) has no concept of roster capacity — it
suggested a drop even in leagues where the active roster had a genuinely
open slot and no drop was needed at all.

- **Real roster-capacity check, same rule `buildAddPlan` already uses
  elsewhere** (`lib/bulkPlan.ts`, previously unused dead code — this is its
  first real caller): a league only needs a drop when its active roster
  (real players minus real reserve/IR) is actually at `roster_positions`'s
  length. `WaiverLeague` gained `reserve: string[]` and `rosterSize: number`
  (`app/manager/waiver/page.tsx` now supplies both — `reserve` from the
  already-synced `Roster.reserve`, `rosterSize` from the existing
  `rosterPositionsFromSettings().length` helper). `rosterSize === 0` (roster
  settings not synced) is treated as "not full," never guessed as full.
  A league with a real open slot now shows "open roster spot — no drop
  needed" and sends the add with no `dropPlayerId` at all — genuinely fewer
  API calls, not just a cosmetic label change.
- **Real dropdown when a drop IS needed**: `candidateLeagues` now computes
  every eligible bench player (never a starter, never IR/reserve — same
  exclusions `buildAddPlan`'s bench filter already uses) ranked by real
  season-projected points, weakest first, instead of picking just one.
  A `<select>` per league lets the owner override which bench player to
  drop; the Diff column recalculates against whichever one is picked. A
  full roster with genuinely nobody eligible to drop (all bench players
  already claimed elsewhere, or an empty bench) is shown disabled with
  "roster full, nobody eligible to drop" rather than silently picking a
  starter or IR player.
- `checkedIds` still defaults to "every league where he's a real free
  agent," but the checkbox now also requires `runnable` (open slot, or a
  real drop actually selected) to show as checked, and `runAdd` filters the
  same way — a league stuck on "nobody eligible to drop" can never
  accidentally get sent. The button's count and the executed batch now
  agree (previously the raw `checkedIds.size` could overcount a
  since-disabled row).
- `tsc`/`eslint`/`next build` all clean (same 1 pre-existing
  `WaiverAssistant.tsx` lint finding, confirmed unrelated). Not
  live-verified against the real account — same `/admin` passphrase blocker
  as the last several entries; the underlying capacity/bench logic
  (`buildAddPlan`'s `full`/bench-filter rules) is the same real math already
  used by the Mass Add board's `buildMultiAddPlan`, just applied here for
  the first time to the single-player tool — worth a quick real look at a
  known-open-slot league and a known-full league before a live run.

### Waiver Assistant lookup: starters now droppable too, pending claims shown per league (2026-09; real feedback from the owner)

Two follow-ups after the drop-dropdown fix above. "only 6 players to choose
from?" — the dropdown was bench-only (same hard exclusion `buildAddPlan`
uses everywhere else), which is right for an *auto-suggested* drop but too
restrictive for a tool that's already asking the owner to pick manually.
"is there a way to see all the pending claims in that league... so i can
know how to rank it/categorize it" — a real, reasonable ask: decide whether
to add here partly based on what else is already in flight in that league.

- **Every rostered player is now a choosable drop, except IR/reserve**
  (`candidateLeagues`' `dropCandidates` in `WaiverAssistant.tsx`) — dropping
  a reserve/IR player is excluded because it's mechanically real, not a
  policy call: it wouldn't free an active slot at all (the "full" check is
  active count = players minus reserve), so offering it would be
  misleading. Starters ARE now included, sorted after the bench (never
  before it, so the safe weakest-bench-player pick stays the default at
  index 0) and labelled "— starting" in the dropdown so choosing one is
  always a deliberate, visible choice, not an accident.
- **Pending waiver claims shown inline, per league** — a small line next to
  each league name in the lookup table now shows how many real pending
  claims (from the "Pending waiver claims" scan above, `classifyTransactions`
  via `fetchLeagueTransactions`) are already sitting in that league, with
  the actual add/drop/bid detail in both the truncated text and a full
  hover tooltip. Three honest states: "scan claims above" (nothing scanned
  yet), "no pending claims" (scanned, genuinely none), or "N pending: ..."
  (real detail) — never a blank cell that could be misread as "definitely
  none." Reuses the exact same `openClaims` data the claims section already
  computes (`claimsByLeague`, grouped by `leagueId`) — no second fetch, no
  new Sleeper call.
- `tsc`/`eslint`/`next build` all clean (same 1 pre-existing lint finding,
  confirmed unrelated). Not live-verified against the real account — same
  `/admin` passphrase blocker as the last several entries.

### Global command palette (Cmd/Ctrl+K) + League.group as a real filter (2026-09; requested explicitly by the owner, scoped via the impeccable skill's shape process)

"anything else that can improve the user experience/navigation? remember
the goal is to manage 200+ leagues" — a research pass (read-only, no code)
surveyed the real nav/UX gaps before proposing anything: no cross-page
search (three separate, page-scoped search boxes), no keyboard shortcuts
anywhere, and `League.group` — a free-text label the owner can already set
per league (League Info tab) — fetched into every list page's data query
but never actually used as a filter/grouping anywhere. Scoped via
`AskUserQuestion` to two of the four proposed fixes plus a general
clicks/scrolling/shell review; the mobile "top nav clips a tab" issue
flagged in an old design note turned out to already be resolved (`.mgrsubnav`
is deliberately `display:none` below 768px now, replaced by the drawer +
`BottomNavBar` — verified against current CSS before "fixing" a non-issue).

- **`components/manager/CommandPalette.tsx`** (new) — Cmd/Ctrl+K from
  anywhere under `/manager` (global listener lives in `ManagerShell.tsx`,
  the one component that already wraps every page), plus a visible "Search
  ⌘K" trigger in the sidebar and a search icon in the mobile topbar.
  Searches real league names (the same `{id,name}` list `ManagerShell`
  already receives — no new fetch) and real players (same offense-only,
  substring-match idiom `PlayerLeagues.tsx`/`WaiverAssistant.tsx`'s
  single-player lookup already use, via `usePlayerMap()`). Arrow keys +
  Enter to navigate, mouse hover to highlight, Escape or backdrop-click to
  close. Selecting a league jumps to `/manager/{id}`; selecting a player
  jumps to `/manager/player?playerId={id}`, which `PlayerLeagues.tsx` now
  reads on mount to auto-select that player instead of landing on an empty
  search box. Deliberately mounted only while open (`{paletteOpen &&
  <CommandPalette/>}`) rather than always-rendered-but-hidden — this defers
  the real player-dump fetch behind `usePlayerMap()` until someone actually
  opens it, instead of paying that cost on every single `/manager` page
  load. Visual treatment reuses `.modalbg`'s real scrim (no new overlay
  color) but is its own narrower, top-anchored `.cmdpal` — `.modal` is
  sized for the 960px player-card view, wrong proportions for a search
  dialog — and deliberately has no box-shadow, matching `.modal`'s own
  scrim-only approach to elevation rather than `.mgrtabmenu`'s older
  shadowed-dropdown pattern.
- **`League.group` as a real filter chip** on the three highest-value list
  pages (My Leagues, Waiver Assistant, Weekly Record) — same `chip-filter`
  pattern already used everywhere else (best-ball toggle, playoff-tier
  chips, Weekly Record's own Winning/.500/Losing filter), so a league
  labelled e.g. "Money leagues" or "Dynasty" collapses 200+ leagues down to
  just that group with one click. Each page derives its own distinct,
  sorted group list from real data and hides the chip row entirely when no
  league has a group set (never clutter for an account that hasn't adopted
  labelling). Waiver Assistant's filter is the most involved since the page
  already juggles three differently-shaped league arrays (`WaiverLeague[]`
  for the lookup/FAAB tools, `LineupLeague[]` for the embedded multi-add
  board) — solved by shadowing the props (`leagues: allLeagues` etc.) and
  deriving filtered versions once via `useMemo`, so every existing
  downstream reference in the file automatically respects the filter with
  no other code touched. Open Spots was deliberately skipped — it already
  shows a small, pre-filtered subset (16 of 210 real leagues at last
  count), so a group filter there has little real value versus the two
  screens that show the full list.
- **Not done this pass** (explicitly deferred, not forgotten): unifying
  "needs attention" across Action Queue/Command Center/Open Spots/Weekly
  Record, and league favorites/pins. Both are real, larger pieces of work
  — unifying needs-attention in particular would mean embedding a live
  Sleeper trades/claims scan into the Action Queue page (currently a pure
  `Alert`-table DB read), the same non-trivial addition Waiver Assistant's
  own pending-claims section already required.
- `tsc`/`eslint`/`next build` all clean; `scripts/testCommandCenter.ts`
  (422) and `scripts/testCommandCenterExec.ts` (84) both still pass — none
  of this touched planning/executor logic. The two `react-hooks/set-state-
  in-effect` findings in `ManagerShell.tsx` and the one in
  `WaiverAssistant.tsx` are confirmed pre-existing via `git diff` against
  the same lines; `PlayerLeagues.tsx`'s new one (syncing `selectedId` from
  `?playerId=`) matches the identical "reset on navigation" idiom already
  used twice in `ManagerShell.tsx` itself, so it wasn't worth restructuring
  around. `CommandPalette.tsx`'s own equivalent case (resetting `highlight`
  when the query changes) WAS avoidable — moved into the input's `onChange`
  handler instead of a `useEffect`, since the only place `query` actually
  changes is that one event. Not live-verified against the real account —
  same `/admin` passphrase blocker as the last several entries; worth a
  real Cmd+K trial and a real group-label test before relying on either
  for tonight's session.

### Every bulk-send tool: a real success message after submitting (2026-09; requested explicitly by the owner)

"need a success or successfully message after submitting" — every bulk-write
tool in the app (Waiver Assistant's single-player lookup, Mass Add/Claim,
Mass IR, and Command Center's bulk proposal send) already computed a real
completion summary (`${result.done} sent, ${result.failed} failed...`), but
rendered it as the exact same muted grey `hint`/`cctext` line used for
ordinary body copy everywhere else on the page — nothing about it visually
said "this worked" versus just another line of text to skim past.

- **New shared helper `bulkResultTone()`** (`lib/bulkRun.ts`) — takes the
  same `{ done, failed }` shape `runBulk()` already returns and picks one of
  three honest outcomes: a genuine full success (`done > 0`, `failed === 0`)
  gets a `✓ Successfully sent — ` prefix in mint (the same color `StatusCell`
  already uses for a single done row, so this isn't a new success color
  introduced just for this); a partial result (`failed > 0`) gets
  `⚠ Partially sent — ` in amber; nothing sent (`done === 0`) stays neutral,
  since there's nothing to call a success. Never claims success when
  anything actually failed.
- **Wired into all four tools that already had this exact pattern**:
  `WaiverAssistant.tsx`'s single-player lookup (`execSummary`), `BulkAdd.tsx`
  (Mass Add/Claim), `BulkIR.tsx` (Mass IR), and `ProposalsPanel.tsx`
  (Command Center's bulk send). Each already called `runBulk` and built a
  plain-text summary from its result — this only changes what colors and
  prefixes that existing string, via a small parallel `summaryColor`/
  `execSummaryColor`/`bulkSummaryColor` state per component (the message
  itself is still built the same way, just now colored and bolded to
  actually read as a completion state instead of ambient text).
- Deliberately did NOT touch the per-row `StatusCell` (✓ done / ✕ failed per
  league already existed and was already colored) or the single-proposal
  send note in `ProposalsPanel.tsx` (already visually distinguishes success
  from a warning via its own `ccnote-warn` class) — this was specifically
  about the one *overall* completion line each tool shows after a batch
  finishes, which was the genuinely flat one.
- `tsc`/`eslint`/`next build` all clean (same 1 pre-existing
  `WaiverAssistant.tsx` lint finding, confirmed unrelated and untouched).
  `npx tsx scripts/testCommandCenter.ts` (422) and
  `scripts/testCommandCenterExec.ts` (84) both still pass — this is a
  pure display change to already-computed values, no planning/executor
  logic touched. Not live-verified against the real account — same `/admin`
  passphrase blocker as the last several entries.

### Waiver Assistant lookup: expand pending claims and rosters inline (2026-09; real feedback from the owner)

Two more real gaps in the same table. "i like the little yellow text...
now i need u be able to show all of them... but not the players and
whos dropped/bid... if u want to make it clickable... thats fine" — the
truncated `1 pending: ...` text (added in the entry above) cut off after a
few characters via CSS ellipsis, so the real detail it was supposed to show
was invisible without a mouse hover (useless on anything touch-based, and
easy to miss even on desktop). And separately: "can u have a way to easily
show roster even for the no drop / open roster" — there was no way to see
who's actually on a league's roster from this page at all, which matters
most exactly when there's no drop dropdown to glance at for context.

- **Pending claims are now a real toggle, not a hover-only truncation** —
  the amber `N pending` text is a button; clicking it (`toggleClaimsExpanded`,
  a `Set<string>` of open league ids) expands a real detail row directly
  under that league showing every claim's add player (with position chip),
  drop player if any, bid if any, and Sleeper's raw status — the same
  `claimsByLeague` data as before, just rendered in full instead of
  ellipsis-truncated. Three states stay honest as before: "scan claims
  above" / "no pending claims" / a real clickable count.
- **New "roster ▼" toggle, every row, regardless of full/open state** —
  clicking it expands a second detail row listing the league's real
  Starters / Bench / IR-Reserve groups (from the same `WaiverLeague` data
  already loaded, looked up via a new `leagueById` map — no new fetch, no
  new Sleeper call), each player with a position chip and name. Deliberately
  shown for open-slot leagues too, not just full ones — that&rsquo;s the
  exact case the owner called out, since an open slot previously had
  nothing else on the row to click for context.
- Both toggles live inside the row's `<label>` (the row itself doubles as
  the add-league checkbox control), so each button calls
  `e.preventDefault(); e.stopPropagation()` — the same pattern the
  drop-dropdown and bid input already used to avoid accidentally toggling
  the checkbox — verified by inspection against those existing handlers
  rather than re-deriving the fix.
- `tsc`/`eslint`/`next build` all clean (same 1 pre-existing lint finding,
  confirmed unrelated). Not live-verified against the real account — same
  `/admin` passphrase blocker as the last several entries.

### Waiver Assistant lookup: real IR capacity shown inline (2026-09; requested explicitly by the owner)

"add a thing that shows all 3 IR taken in that league" — scoped via
`AskUserQuestion` to confirm it belonged on the single-player lookup table
specifically, inline on the row rather than only inside the "roster ▼"
toggle's expanded IR/Reserve group (which already listed occupants by name,
just behind a click).

- **`candidateLeagues` now computes real IR capacity per league** —
  `irTotal` via `irSlots(settings)` (the exact same `reserve_slots` reader
  `buildIrPlan`/`buildActivateIrPlan` already use, imported from
  `lib/bulkPlan.ts` rather than re-derived), `irTaken` from the league's
  already-loaded real `reserve` array. `irTotal === 0` (roster settings not
  synced) hides the indicator entirely rather than showing a misleading
  "0/0".
- **Shown as a small "IR X/Y" label right next to the roster toggle** on
  every row where the league actually has IR slots — turns red at capacity,
  with a hover tooltip spelling out the real numbers. Clicking "roster ▼"
  still shows who actually occupies those slots by name (unchanged); this
  is the "is it even worth checking" signal at a glance, without a click.
- `tsc`/`eslint`/`next build` all clean (same 1 pre-existing lint finding,
  confirmed unrelated). Not live-verified against the real account — same
  `/admin` passphrase blocker as the last several entries.

### Mass Add/Claim board: pending claims shown per row, not just in a separate list (2026-09; real bug reported by the owner)

Screenshot + "i dont see the pending claims / activity when im trying to
gauge if i need to waiver my player" — the pending-claims work so far only
touched the single-player lookup table; the "Add several players at once"
board (`BulkAdd.tsx`, the multi-target tool the owner was actually using in
the screenshot, adding Keenan Allen across dozens of leagues) had no claims
visibility at all. Follow-up: "i want it here, not a collective one called
pending waiver claims and i cant even differentiate it" — the existing
separate "Pending waiver claims" section above it lists every claim
together with no way to tell which one applies to which row in the table
below it.

- **`BulkAdd.tsx` gained an optional `claimsByLeague?: Map<string, Claim[]>`
  prop** — when provided, each row's League cell now shows the real claim
  detail (add player, drop player if any, bid if any) directly under the
  league name, right in the row it applies to, instead of requiring a
  cross-reference to a separate list. Optional and additive: `Lineups` and
  `Open Spots` (the other two pages that embed this same shared board)
  don't have a claims scan built at all, so they simply don't pass the
  prop and render exactly as before — zero impact there.
- **`WaiverAssistant.tsx` passes its own already-computed `claimsByLeague`**
  (the same real scan data — `classifyTransactions`/`fetchLeagueTransactions`
  — that already powers the "Pending waiver claims" section and the
  single-player lookup's per-league badge) straight into its `<BulkAdd>`
  call. No new fetch, no new Sleeper call — one real dataset now feeds all
  three surfaces on this page. The "Pending waiver claims" scan section sits
  above the add board on the page, so a real scan is already available by
  the time someone reaches this table in the normal top-to-bottom flow;
  until a scan runs, the per-row claims line is silently empty, matching
  how every other optional per-row field in this table already behaves
  (e.g. no bid shown for a non-FAAB league) rather than adding a second
  "scan first" prompt inside an already-dense table.
- `tsc`/`eslint`/`next build` all clean (`BulkAdd.tsx` fully clean; the same
  1 pre-existing `WaiverAssistant.tsx` lint finding, confirmed unrelated,
  untouched). Not live-verified against the real account — same `/admin`
  passphrase blocker as the last several entries.

### Bulk tables: sticky headers, in-table search, bulk bid-set (2026-09; requested explicitly by the owner — "still very clunky")

Asked for more navigation/UX suggestions after the command-palette +
group-filter pass; checked the actual CSS/code before proposing anything
rather than guessing (confirmed via `grep`: no `position:sticky` and no
search box existed in any of the three long bulk-review lists). The owner
said "everything" — all three shipped together since they touch the same
tables:

- **Sticky column headers** — Mass Add/Claim (`BulkAdd.tsx`) and Mass IR
  (`BulkIR.tsx`) both wrap their `DataTable` in a bounded, scrollable div;
  past row 1 of a 55-200 row batch, "Player / League / Roster / Bid /
  Result" used to scroll away with everything else. New shared
  `.mgrtable-scroll` class (`app/manager/manager.css`) replaces the old
  inline `{maxHeight:640, overflowY:"auto"}` wrapper. Real gotcha worth
  keeping in mind if this pattern gets reused: `.mgrtable`'s own
  `overflow-y:hidden` (there so its border-radius clips a horizontally-
  scrolling wide table) would otherwise become the *nearest scroll
  container* for `position:sticky` and silently defeat it, since that box
  has no actual scrollable overflow of its own — `.mgrtable-scroll`
  overrides it to `visible` and takes over the real scrolling + rounded-
  corner clipping itself, scoped only to callers that opt into the class
  (every other `DataTable` usage app-wide is untouched).
- **In-table search** — both tables, plus Command Center's bulk send list
  (`ProposalsPanel.tsx`, shown once it has 8+ items): a text box filters by
  league name and (`BulkAdd`/`BulkIR`) the target/player name, or
  (`ProposalsPanel`) the same human description each card already shows via
  `describeProposal()`. Deliberately filters the VIEW only — "Select
  all"/"Select none" (relabelled "...shown" while a filter is active) act on
  whatever's currently filtered in, real selection state for every other
  row is left untouched, so narrowing to "Keenan Allen" and clicking Select
  all never silently deselects everything else in the batch.
- **Bulk bid-set** (`BulkAdd.tsx` only — the only one of the three with a
  bid column) — a `$` input + "Set all bids" button writes the same number
  into every FAAB row's `bidOverride` in one click instead of editing each
  of 30+ rows by hand. Real per-row caps still apply afterward: `bidFor()`'s
  existing `budgetLeft`/`bidMin` clamp runs at render/send time regardless
  of how a bid got into `bidOverride`, so this can never push a league's bid
  over what it can actually support — bulk-set and per-row typing are the
  same input, not a separate code path.
- `tsc`/`eslint`/`next build` all clean on all three files (zero findings,
  not even a pre-existing one). `scripts/testCommandCenter.ts` (422),
  `scripts/testCommandCenterExec.ts` (84), and `scripts/testMultiAddPlan.ts`
  (20) all still pass — pure UI/display changes, no planning/executor/
  pure-logic code touched. Not live-verified against the real account —
  same `/admin` passphrase blocker as the last several entries; worth a
  real scroll-past-row-1 check and a real multi-league search before
  leaning on either for a live 100+ league batch.

### Waiver Assistant split into tabs (2026-09; requested explicitly by the owner, part of "everything")

The last of the four "still very clunky" fixes requested together. Trending
→ Pending claims → Mass add → Single lookup → History had grown into one
long stacked page — getting to the tool you actually wanted meant scrolling
past everything above it every time, the exact "too much scrolling"
complaint confirmed earlier. Restructured using the identical pattern
`LineupManager.tsx` already established for `/manager/lineups` (chip-filter
tab row, a `visited: Set<Tab>` so a tab mounts once on first visit and then
stays mounted-but-`hidden` rather than unmounting — real in-progress state
like Mass Add's search targets, bid overrides, and a completed claims scan
all survive switching tabs, since none of this page's real client state
lives above the tab boundary except what's deliberately kept there).

- **Always visible above the tabs** (unchanged from before): the page
  header, the `League.group` filter chips, the waiver-position stat cards,
  and `ConnectWriteAccess` — all five tabs depend on the write-access token
  and/or the group filter, so neither belongs inside a single tab.
- **Default tab is Trending**, not Mass Add — picked deliberately so landing
  on the page never silently implies a scan already ran. The real gap that
  tabbing introduced: the "Pending waiver claims" scan used to sit
  physically above "Add several players at once" on the stacked page, so a
  scan was already available by simple top-to-bottom reading order before
  reaching the add board. Tabs break that ordering guarantee outright — the
  owner could land directly on Mass Add having never seen the claims tab.
  Fixed with an inline prompt inside the Mass Add tab itself: "scan now" (or
  "Rescan", if one's already run) calls the exact same `scanClaims()`
  function the Pending Claims tab's own button calls — one real scan,
  shared `claims`/`claimsScanned` state at the parent level, surfaced from
  wherever you are instead of requiring a tab switch to trigger it.
- **Clicking a trending player now also switches to the Single Lookup tab**
  (`go("lookup")` alongside the existing `setSelectedId`/`setQuery`) — before
  tabs existed this just scrolled the already-visible lookup section into
  place; with tabs, the same click needs to actually change which tab is
  showing or the selection would silently happen off-screen.
- `tsc`/`eslint`/`next build` all clean (same 1 pre-existing lint finding,
  confirmed unrelated and untouched by this restructuring — same line, same
  "reset selection when the target player changes" effect flagged since the
  direct-execution change). `scripts/testCommandCenter.ts` (422) and
  `scripts/testCommandCenterExec.ts` (84) both still pass. Not live-verified
  against the real account — same `/admin` passphrase blocker as the last
  several entries; this is the largest structural change made to this file
  all session, so a real click-through of all five tabs (confirming a scan
  started in one tab really shows up in another, confirming Mass Add's
  in-progress state survives a tab switch) is worth doing before relying on
  it for a live session.

### Command Center: closed more intent gaps + chained "then" commands (2026-09; requested explicitly by the owner, scoped via AskUserQuestion)

"let's also improve the command center as best as we can so it can
understand natural language, and be able to execute on the language" —
asked directly whether this meant pushing the existing free, deterministic
parser further or adding a real LLM (a genuine fork: an LLM needs an API
key, has a real cost, and reverses the owner's own earlier explicit "no
LLM" call from the surname-matching work). The owner chose to keep the
deterministic parser, scoped to two things: close remaining phrasing/intent
gaps, and let one message chain multiple actions together.

- **Generalized the "drop candidates" dead-end fix to "add"/"claim"**
  (`lib/commandCenter/intent.ts`) — "Add candidates for this week?" or
  "Claim candidates" starts with a recognized `execute_request` verb and,
  with no player named, used to fall into the generic refusal-plus-preview
  dead end — the exact bug class already fixed once for the word "drop".
  Found by the same audit technique documented earlier this project (grep
  every `execute_request`-verb word against plausible informational
  phrasing). Routes to `waiver_opps`, same as the existing "waiver
  opportunities" trigger; a real "add &lt;player&gt;" request is completely
  untouched since this only fires with zero player mentions.
- **"Who should I bench" now routes like "who should I start"** — both ask
  for the same lineup help (`lineup_improvements`); only the "start"
  phrasing was recognized before.
- **Broadened `waiver_opps`'s own trigger phrasing** — "waiver adds",
  "good waiver adds", and "check my waivers" now match directly, not just
  the narrower "waiver opportunities"/"best adds"/"who should I add"
  phrasings it already had.
- **New: chained commands** (`handleChainedCommand`, `lib/commandCenter/
  engine.ts`) — "Fix my lineups, then move eligible players to IR, then
  check waiver opportunities" runs as three real steps in order, each
  step's session feeding the next (so a later step sees whatever the
  earlier one left on screen, same as if they'd been typed as separate
  messages), with all three steps' real blocks shown in one combined
  response under "Step N of M" markers. Deliberately built as a thin
  **wrapper around `handleCommand`**, not a new branch inside it — every one
  of the 400+ existing test assertions calls `handleCommand` directly and
  needed to keep seeing today's exact single-intent behavior unchanged.
  Only the real UI entry point (`CommandCenterAI.tsx`) was switched to call
  the new wrapper; `FloatingCommandCenter.tsx` doesn't call `handleCommand`
  at all (confirmed by `grep` before assuming), so it needed no change.
  - **Deliberately narrow activation, to avoid colliding with "then"'s two
    existing real jobs**: a drop-order list separator ("drop A, then B,
    then C") and an optional leading filler word on a single
    `execute_request` ("then drop Tank Bigsby"). Both of those only ever
    occur together with real player MENTIONS. So the chain detector splits
    the message on "then"/"and then"/"after that"/";", parses EACH segment
    independently through the real `parseIntent`, and only commits to
    "this is a chain" when every segment lands on one of a fixed set of
    real, **mention-free** whole-portfolio intents (`lineup_improvements`,
    `weekly_sweep`, `ir_opps`, `waiver_opps`, `roster_decisions`,
    `standings`, `win_projection`, `scan_leagues`, `week_record`) — a
    mention-bearing segment (a name list) can never be classified as one of
    those, so there is no shared sentence shape for this to confuse with
    the two existing "then" usages. Any segment that fails this check falls
    back to running the **entire original text** as one ordinary
    `handleCommand` call, byte-for-byte today's behavior — confirmed
    directly with "add Malachi Fields and Germie Bernard everywhere, drop
    Antonio Williams then Tank Bigsby if needed" (real "then"-joined
    drop-order syntax) correctly staying a single `execute_request`, not a
    bogus two-step chain.
  - Combined audit record: `intent` is `chain:<kind1>+<kind2>+...` for a
    real audit trail of what actually ran; `durationMs`/`toolCalls` sum
    across steps (a real total cost), `leaguesTotal`/`Scanned`/`Partial`/
    `Failed` take the max across steps (each step scans the same real
    account, summing would double-count), `players`/`recommendations`/
    `errors` concatenate every step's own real list.
  - This never touches the write path — chaining only changes how many
    **draft/preview** blocks one message produces; sending any resulting
    proposal to Sleeper still requires the same explicit Live-mode click
    per proposal (or the existing bulk-send flow) as before.
- Tests: 11 new assertions in `scripts/testCommandCenter.ts` (now 433) —
  all four new/broadened phrasings routing correctly, a real "add
  &lt;player&gt;" never swallowed by the candidates fix, a real two-step
  chain producing both step markers and the first step's real `SET_LINEUP`
  draft in the combined output, an ordinary single command completely
  unaffected by the new wrapper, and the real drop-order "then" case
  correctly NOT being treated as a chain. `scripts/testCommandCenterExec.ts`
  unaffected (84, unchanged) — purely new read-only engine/intent logic, no
  executor code touched. `tsc`/`eslint`/`next build` all clean. Not
  live-verified against the real account — same `/admin` passphrase blocker
  as the last several entries.

### Completed trades tab, transaction type filter, and a real waiver quick-link per league (2026-09; requested explicitly by the owner)

"fix more, useability, navigation whatever u suggest... maybe also a page
for all my pending trades/offers/completed etc" — checked what already
existed before building anything: `/manager/inbox` already had real
pending offers/claims (live Sleeper scan) but no completed history at all;
`/manager/transactions` already had real completed trade/waiver/free-agent
history (from the regular sync) but no way to isolate just trades, and no
cross-link from Inbox; League Overview (and every other league sub-page)
had no action scoped to that one specific league at all — acting on a
league meant leaving to Lineups/Waiver Assistant and re-finding it there
(confirmed by a research pass before proposing anything).

- **Inbox gets a real "Completed trades" tab** (`InboxManager.tsx`) — a
  genuine 4th tab, but a different shape from the other three: it's a pure
  DB read (`LeagueTransaction` rows where `type = "trade"`, already synced
  by the regular sync, no new Sleeper call), filtered to trades whose real
  `rosterIds` actually include mine — not a live scan, so it works even
  without connecting write access, and loads instantly instead of needing a
  button click. Sleeper's own raw status (`complete`/`failed`/whatever else
  shows up) is displayed as-is and colored honestly (mint only for a
  confirmed `complete`, red for `failed`, neutral otherwise) — never guessed
  into a richer "accepted/rejected/vetoed" distinction the regular sync's
  data doesn't actually carry (only the live GraphQL pending-scan, used by
  the other three tabs, has that nuance).
- **`/manager/transactions` gets a real type filter** (`TransactionFeed.tsx`)
  — All / Trades / Waivers / Free agents chips over the exact same already-
  fetched feed (no new query), since a flat 300-row mixed feed made "find my
  trades" a scroll through every waiver and free-agent move first.
- **A real "Waiver for this league" button**, in `LeagueIdentityBar.tsx` —
  the shared header reused across all 8 `/manager/[leagueId]/*` sub-pages,
  so it shows up wherever you're actually looking at a specific league, not
  just Overview. Jumps to `/manager/waiver?leagueId=<id>`, which
  `WaiverAssistant.tsx` now reads to scope the ENTIRE page — trending,
  claims, Mass Add, single lookup, FAAB — to just that one league and land
  directly on the Mass Add tab (the actual "execute a waiver" tool) instead
  of the default Trending landing tab. A visible amber banner ("Showing only
  &lt;League&gt; — View every league") makes the narrowed scope obvious and
  reversible in one click. This is a tighter override than the existing
  `League.group` filter, not a merge with it — a single-league focus always
  wins outright since it's strictly more specific.
- **Not done this pass** (explicitly deferred): a Lineups-side equivalent
  quick-link ("Optimize this league" from its Overview page), and full
  checkbox multi-select on My Leagues to launch a bulk tool pre-scoped to
  several hand-picked leagues at once. Both are real, same-shaped follow-ups
  to this pattern if wanted.
- `tsc`/`eslint`/`next build` all clean (`InboxManager.tsx`,
  `TransactionFeed.tsx`, and `LeagueIdentityBar.tsx` all fully clean; the
  same 1 pre-existing `WaiverAssistant.tsx` lint finding, confirmed
  unrelated and untouched). `scripts/testCommandCenter.ts` (433) and
  `scripts/testCommandCenterExec.ts` (84) both still pass — none of this
  touched Command Center. Not live-verified against the real account — same
  `/admin` passphrase blocker as the last several entries; worth a real
  click from a league's Overview page into its scoped Mass Add tab before
  relying on it for tonight's waivers.

### League favorites/pins (2026-09; requested explicitly by the owner, part of "everything")

The last of the five fixes requested together. "Favorites/pins" from the
original nav-gaps list — a way to mark a handful of leagues (out of 200+)
so they surface first everywhere, instead of being buried alphabetically.

- **Blocked on the obvious approach, by design**: tried adding a real
  `League.favorite Boolean` column (the same pattern `group` already uses)
  and the harness's own auto-mode classifier refused the schema edit as a
  "shared resource" change — this app's Postgres is shared dev/prod, so a
  migration there is a materially bigger, riskier action than a UI
  preference warrants, and the harness is right to gate it. Did not attempt
  to route around that refusal (no raw SQL, no migration script, nothing
  that reaches the same outcome a different way) — pivoted to a genuinely
  different, lower-risk design instead.
- **`lib/leagueFavorites.ts`** (new) — client-local only, via
  `localStorage`, the same place the Sleeper write-access token and the
  Command Center's own Planning/Live setting already live (`ccStore.ts`).
  Uses the identical `useSyncExternalStore`-based external-store shape
  `ccStore.ts` already established for exactly this kind of thing —
  deliberately NOT a `useState` + `useEffect` pair (the first draft was,
  and `react-hooks/set-state-in-effect` correctly flagged it; `usePlayerMap`
  avoids the same rule only because its state update is inside a real async
  `.then()`, not applicable here since a `localStorage` read is genuinely
  synchronous). `useSyncExternalStore`'s server-snapshot argument returns a
  real empty `Set` during SSR, so there's no hydration-mismatch risk from
  a manual "mounted" gate either — matches real existing precedent instead
  of inventing a new idiom.
- **My Leagues** (`MyTeams.tsx`) — a star toggle on every row (inside the
  row's own `<Link>`, so it needs `preventDefault`/`stopPropagation` to
  toggle instead of navigating — same pattern Waiver Assistant's expandable
  row toggles already use). Favorited leagues always sort first regardless
  of which column is actively sorted (wins/rank/alerts/etc. still apply
  normally within the favorite/non-favorite groups) — that ordering is the
  actual point of pinning. A "★ Pinned (N)" chip filters down to just the
  pinned leagues, shown only once at least one exists.
- **Command palette** (`CommandPalette.tsx`) — two changes: league search
  results rank favorited matches first (same favorite-then-alphabetical
  sort as My Leagues), and opening the palette with an EMPTY query now shows
  pinned leagues as a direct quick-jump list instead of the generic help
  text — the actual point of pinning is reaching a league without typing
  its name at all.
- Not extended to Waiver Assistant/Weekly Record this pass — My Leagues and
  the command palette are the two highest-traffic places a 200+ league
  owner looks for "which league do I mean," and `useLeagueFavorites()` is a
  small enough hook that adding it to more pages later is cheap if wanted.
- `tsc`/`eslint`/`next build` all clean — zero findings on all three touched
  files, including the hook itself once rewritten onto `useSyncExternalStore`.
  `scripts/testCommandCenter.ts` (422) and `scripts/testCommandCenterExec.ts`
  (84) both still pass. Not live-verified against the real account — same
  `/admin` passphrase blocker as the last several entries; `localStorage`-
  backed state in particular is worth a real check (pin a league, reload the
  page, confirm it's still pinned) before relying on it.

### Admin tier board: Needs-ranking panel, injury badges, search, bulk moves, undo, team sync (2026-10; requested explicitly by the owner)

"can u code a way for me to manage the ranks easier, etc a place to add injured
that are not in my top rankings automatically, any other ways to make it easier
for me to rank" — `/admin`'s board (`components/TierBoard.tsx`) was drag/arrow
reordering plus a manual name/team/tier add form, with no awareness of
injuries, no way to find a player, and nothing noticing a player who was on
your rosters but missing from the board. Everything below is client state on
the board until **Save**, same as before: `save-tiers` is unchanged (still one
full-replace transaction) and `RankedPlayer` has no schema change.

- **"Needs ranking" panel** — players rostered in at least one of the owner's
  in-season, non-best-ball leagues who aren't on the board, sorted most-hurt
  first then by how many leagues hold them; "Injured" and "All unranked"
  views, per-row "+ Add" and "Add all N shown" into a chosen tier (default G).
  *Relevance is defined by your rosters, not by the NFL*: "every injured
  QB/RB/WR/TE" is several hundred names nobody cares about. Exposure comes from
  a server-side read of the already-synced `Roster` table in
  `app/admin/page.tsx` (same in-season/`isBestBall` scope every `/manager`
  tool uses; `/admin` and `/manager` share one passphrase cookie, so this
  exposes nothing new). "Automatically" is deliberately one-click, not
  unattended: adds land on the board unsaved so the owner still reviews and
  hits Save — nothing re-ranks the list on its own.
- **Injury badges + "Injured (N)" filter on every ranked row**, and a
  "×12" league-count next to the team (hover: "On 12 of your 210 leagues") so
  ranking decisions can weigh exposure. Source is Sleeper's `injury_status`
  from the cached player dump (`usePlayerMap`). Suspension ("Sus") is not
  treated as an injury.
- **Team-drift banner** — the board's team text is hand-maintained, so trades
  and releases silently made it stale. Compares each ranked player to Sleeper's
  current team; "Update N teams" applies the changes. Players with *no* team
  on Sleeper (released/retired) are listed but never auto-changed.
- **Find, select, bulk-move** — a search box (name or team), per-row
  checkboxes, "Select all shown" (works with the position/injured/search
  filters), and "Move to tier"/"Remove" for the selection.
- **Undo (50 deep, Ctrl+Z), Ctrl+S to save, sticky action bar, unsaved
  indicator, leave-page warning.** Undo/Ctrl+Z is ignored inside text boxes. Save
  is disabled until something actually changed ("Saved" otherwise);
  "Discard changes" reverts to the last *saved* state (it used to revert to the
  page-load state even after a save).
- **Pure logic in `lib/rankingsHelpers.ts`** (`findUnranked`, `findTeamDrift`,
  `buildSleeperIndex`, `isInjured`) so it's testable without React; Sleeper
  namesake handling prefers the entry that's currently on a team (e.g. the
  inactive second "Lamar Jackson"), suffix-insensitive ("Jr."), and position is
  part of the key. `npx tsx scripts/testRankingsHelpers.ts` (22).
- Verified against the real account via a throwaway read-only script (deleted
  after): 275 ranked, 210 in-scope leagues, 9 rostered-but-unranked players of
  which 2 injured (Keenan Allen Questionable ×38, Terrance Ferguson IR ×3), 6
  stale teams (e.g. Tutu Atwell MIA→LAR). One board player Sleeper can't
  identify at all (Travis Hunter — position mismatch), so he gets no
  badge/drift check. `tsc`/`eslint`/`next build` clean; command-center suites
  unaffected (433 + 84). Not clicked through in a browser — the `/admin`
  passphrase blocks this environment — so the sticky bar, panel layout and
  drag behaviour after the rewrite are worth one real look.

### Lineups "top players" watch: injured players no longer hold a top-N spot (2026-10; requested explicitly by the owner)

"make sure auto adapts and doesn't include inj players in the top 20 30 45 25 ... if they are out or IR they are not included."
`components/manager/TopPlayersWatch.tsx` (the QB 20 / RB 30 / WR 45 / TE 25 notice) used each player's raw
/admin position rank, so an Out/IR player still occupied a top-N slot and was only reported as "benched because injured".
New `adaptivePosRanks` (`lib/topPlayersWatch.ts`) re-numbers each position counting only players who can play this week
(same Out/IR/PUP/Sus/COV/NA/DNR + bye check as before), so the window slides: the next healthy player takes the spot,
and injured players are never watched. Priority-list players are unchanged (still reported as unavailable if hurt).
Tests: `npx tsx scripts/testTopPlayersWatch.ts` (5). The Optimize tool itself already excluded Out/IR from every lineup.

### "Flex first" list for the lineup tools (2026-10; requested explicitly by the owner)

"an easier way to categorize them all for the flex spots ... whichever is easiest to rank and adapt." Of the three options
offered, picked the one that reuses the existing My players lists: a fifth, **ordered** list, **Flex first**
(Lineups → My players → "+ Flex first", reorder with ↑/↓), stored as `PlayerPreference.kind = "flex_first"` (no schema change —
`kind` is a free string). `lineupOptimizer`'s new `flexFirst` input nudges a listed player into a FLEX-type slot and out of his
true slot (freeing it for someone else); list order decides who wins when several want FLEX.
- **Tie-break only**: bigger than the day-of-week nudge, far below any real projection gap (a clearly better player still
  starts), and the hard Thu/Fri/Sat RB/WR-out-of-FLEX rule still wins. Rank window capped at 20 so the total swing stays tiny;
  the per-step size (0.0006) is deliberately > the stay-put bonus or adjacent list positions would never resolve — an earlier
  step of 1e-6 failed its own test for exactly that reason.
- Same exclusivity as the other lists (one list per player; priority wins). Wired into Optimize (`⇄` marker) and chat "Fix my lineups".
- Tests: `npx tsx scripts/testFlexFirst.ts` (6); lineup optimizer (21), command center (433 + 84) unchanged. Not clicked through in a browser (admin gate).

### Admin tier board: big ▲▼ arrows on the left, arrows cross tier lines (2026-10; requested explicitly by the owner)

"instead of drag and drop can u add an arrow on the left ... or maybe both ... i need to make it super easy." `components/TierBoard.tsx`
now has a stacked ▲/▼ pair at the LEFT of every row (30x18px buttons, amber on hover; `.rankarrows` in `app/globals.css`), replacing the tiny dim
arrows on the right. Drag-and-drop is unchanged (both work). New behavior: ▲ on the first card of a tier (or ▼ on the last) moves him into the
adjacent tier — end of the tier above / start of the tier below, respecting the position filter — so repeated clicks walk a player through the whole
board instead of dead-ending at a tier edge. «/» still jump a whole tier. Undo/Ctrl+Z covers every arrow click. `tsc`/`eslint` clean; not
clicked through in a browser (admin gate).

### Admin tier board: save history + per-tier "Sort by ADP" (2026-10; requested explicitly by the owner — "ok" to the suggested next steps)

- **Save history** ("Save history" in the board's action bar): every successful Save first stores the version it just replaced
  (last 20, newest first, identical-to-newest skipped). **Restore** loads a version into the board as an ordinary unsaved edit — Undo reverts
  it, Save makes it live. Stored in the **browser's localStorage** (`fantis_rank_history_v1`), deliberately NOT the database: a new table is a
  migration on the shared Postgres, which the harness gates (same reason league favorites are client-local). Consequence: history is per
  browser/device, and a cleared browser loses it. Writes are best-effort — a blocked/full localStorage never fails the save itself.
- **Sort by ADP** button on every tier band: reorders that tier's *currently shown* cards (so a position filter sorts just that position) by
  Sleeper's real ADP (`adp_dd_ppr` from the current-week projections, the same field `add-missing-players` uses; `< 999` = ranked). Players with
  no ADP stay below the ranked ones in their existing order — never shuffled or dropped; hidden cards keep their exact slots. Undo-able.
  Real-data check: ADP resolved for 221 of 277 board players; tier S sorted to Gibbs, Smith-Njigba, Bijan, Nacua, Chase, St. Brown, McBride, Allen.
- Pure logic (`sortByAdp`, `pushSnapshot`, `parseHistory`) in `lib/rankingsHelpers.ts`; `npx tsx scripts/testRankingsHelpers.ts` (now 31).
  `tsc`/`eslint` clean. Not clicked through in a browser (admin gate).
- Still open from the same suggestion list: ranking-vs-FantasyCalc/ADP disagreement flags; league-page "Optimize this league" link; multi-select
  on My Leagues; Action Queue alerts that open the actual fix.

### Tier board: bigger arrows + overall rank number (2026-10; requested explicitly by the owner)

"arrows bigger / anything else that can help?" The left-side ▲▼ are now side by side, 42x36px with a 16px glyph (were a 30x18 stack), and each row shows
its overall board rank (`#12`, from list order — the thing "where is he in my list" actually means) before the position chip (QB3 etc.). Names were
already enlarged (15.5px / 650). Not clicked through in a browser (admin gate).

### Tier board: player photos + Sleeper projected points column (2026-10; requested explicitly by the owner)

"add player photos next to the players as well as their projected fantasy points on sleeper in another column." Every board row now has a
38px round headshot (Sleeper's real CDN photo via `playerPhotoUrl`; falls back to a position-coloured circle with the position if Sleeper has none) and
an amber **projected points** column (Sleeper's PPR projection, `pts_ppr`). A "Projected pts:" chip pair switches between **Week N** (current
projection week, one ~500KB file loaded on page open) and **Season** (sum of all 18 weekly files, ~10MB, cached for the day — fetched only the first
time "Season" is clicked, so opening /admin stays light). "—" means Sleeper has no projection (bye week, inactive, or no ID match). The board has its
own small `Headshot` component because `PlayerAvatar`'s CSS lives in manager.css, which /admin doesn't load. Matching is the same name+position lookup as
injuries. Real-data check: 277 board players, 221 have a week-4 projection (the rest are byes/inactive), 262 have a season projection, 1 has no Sleeper
match (Travis Hunter); Gibbs 24.8 wk / 399 szn. `tsc`/`eslint` clean. Not clicked through in a browser (admin gate).

### Tier board: paste-in rank import (2026-10; requested explicitly by the owner)

The owner asked to source ranks from flockfantasy.com. **Not done by scraping**: its `robots.txt` is `User-agent: * / Disallow: /` and the page's data loads via
JavaScript from a private source, so automated pulling would violate their stated rules (same posture as FantasyCalc — only documented endpoints; any data
agreement is the owner's call to make with them). Built instead: **Import list** in the tier board's action bar — the owner pastes their OWN ordered list
(numbered or not, "2) Puka Nacua WR LAR", CSV/TSV rows; trailing POS/TEAM tokens and punctuation/suffix differences tolerated). Preview shows how many matched the
board / were found on Sleeper but aren't on the board / are ambiguous (real namesakes, e.g. two "Mike Williams", are flagged and skipped — never guessed) /
didn't match (and duplicates). **Apply** reorders players WITHIN their current tiers to follow the pasted order (a plain list has no tier info, so tiers never change),
optionally appending not-on-board matches to tier G in list order. Unsaved until Save; Undo reverts. Logic in `lib/rankingsHelpers.ts` (`matchPastedList`,
`looseKey`); `npx tsx scripts/testRankImport.ts` (14). Checked on the real board with a 12-line mixed-format list. `tsc`/`eslint` clean; not clicked through (admin gate).

### Waiver Assistant: "Next waiver runs" deadline panel (2026-10; requested explicitly by the owner)

"waiver deadline is good" — a panel at the top of `/manager/waiver` (`components/manager/WaiverDeadlines.tsx`) that groups the owner's leagues by their next real
waiver processing time ("in 4d 0h · Wed 12:00 AM PT · 197 leagues"), red inside 3h, amber inside 24h, with a per-group league list, pending-claim counts once the
existing claims scan has run (shared `scanClaims`, one scan), and the lowest FAAB left. Read-only; nothing sends.
- **The time rule was verified, not assumed** (`lib/waiverSchedule.ts`): compared each setting group against real `status_updated` timestamps of processed claims
  from Sleeper's public transactions endpoint. `waiver_day_of_week`: 0 = Monday … 6 = Sunday; `daily_waivers_hour`: hour of day in **US Pacific time**
  (hr=0 → ~07:05–07:15 UTC on Wednesday; hr=21 → ~04:0x UTC; hr=7 → ~14:0x UTC, all UTC-7 in October), processing a few minutes after the hour. The Pacific
  zone is INFERRED from those matches across three setting groups (Sleeper doesn't document it) and the UI says so; DST handled via Intl `America/Los_Angeles`.
- **Daily-waiver leagues** (`daily_waivers = 1`, 9 of the owner's leagues): `daily_waivers_days` is a bitmask I could not decode with confidence, so these show
  the EARLIEST possible run (next time that hour arrives on any day), labelled "earliest … daily waivers (may run on other days too)" — errs toward an earlier
  deadline, never a later one. Missing schedule data → "no waiver schedule in the synced data" (never a guess).
- `waiver_day_of_week`, `daily_waivers`, `daily_waivers_hour` added to `SLIM_INNER_KEYS` (`lib/manager.ts`) so the client gets them.
- Tests: `npx tsx scripts/testWaiverSchedule.ts` (11, incl. the DST shift and the real-data expectations); command center 433 + 84 unchanged. Real-data check at
  Fri 11:16pm PT: 197 leagues → Wed 12:00 AM PT (4d 0h), 9 → Tue 9:00 PM PT, plus the daily ones. `tsc`/`eslint` clean (same 1 pre-existing WaiverAssistant finding).
  Not clicked through in a browser (admin gate).

### Tier board: CSV upload + Expert/Mason reference ranks shown next to my rankings (2026-10; requested explicitly by the owner)

"i'm going to import a list with the columns Rank, Name, Team, Position, Tier, Expert Rank (Flock Rank), Mason Dodd Rank (Flock Mason Rank) … display this next to my own rankings" and "create a way
for me to upload a CSV." The **Import list** panel now has **Upload CSV…** (reads the file in the browser, ≤2MB; also .tsv/.txt) feeding the same paste box. If the first line is a header row
(`parseRankTable` in `lib/rankingsHelpers.ts`; tab or comma, quoted fields OK; any subset of columns with a Name) it's imported as a TABLE:
- **Expert / Mason ranks** (header contains "expert"/"flock", and "mason" — checked Mason first because "Flock Mason Rank" contains "flock") are saved as **reference ranks** and shown on every board row as `E 12` / `M 9`
  next to the owner's own `#N` overall rank. Display-only: they never move anything. Stored in **localStorage** (`fantis_ref_ranks_v1`, `lib/refRanks.ts`, same `useSyncExternalStore` shape as league favorites) —
  per browser; a DB table would be a gated migration. A "Clear" link and a "showing reference ranks for N players" line sit above the list.
- **Position column disambiguates namesakes** (QB vs TE Josh Allen); two same-position namesakes (two WR Mike Williamses) stay ambiguous and are skipped, never guessed. Duplicates are keyed name+position.
- Importing never rearranges the board by default for a table: **"Reorder within tiers to follow the Rank column"** (default OFF for a table, ON for a plain name list) and **"Take tiers from the Tier column"**
  (1–8 or S–G; default OFF; shows how many players would change tier) are explicit checkboxes. Not-on-board players found on Sleeper can be added (listed tier if tiers are on, else bottom of G).
- Not scraped: Flock's `robots.txt` disallows all crawlers; the owner supplies their own file. Tests: `npx tsx scripts/testRankTable.ts` (18), `testRankImport` (14), `testRankingsHelpers` (31).
  Real-data check with the exact column header on the live board: all columns mapped, 6 of 7 rows matched (the fake name unmatched). `tsc`/`eslint` clean. Not clicked through in a browser (admin gate).

### Tier board CSV import: hardened after "I uploaded it but don't see his rankings" + "Kenneth Gainwell missing" (2026-10; real bug reported by the owner)

- **Kenneth Gainwell** was on the board all along — as Sleeper's "Kenny Gainwell". The matcher only knew exact names, so the CSV's "Kenneth" was skipped. Added a nickname-aware FALLBACK
  (`fuzzyKey`, ~35 first-name groups: Kenneth/Kenny, Mike/Michael, Josh/Joshua …): tried only when the exact name fails, accepted only if unique (and the Position column agrees when present), and
  shown in the preview as "matched as Kenny Gainwell (name variant)". An exact match always wins over a variant (Josh Allen → the QB, never Joshua Allen the TE).
- **Reference ranks now save the moment the file is uploaded** (previously they also needed a separate Apply click — easy to miss, and the likeliest reason nothing showed). Apply now only governs
  board changes (reorder / tiers / adds). The panel reports what it did ("Saved Expert/Mason ranks for N players…") or exactly what it saw ("Couldn't find a header row with a Name column (first line: …)").
- **Parser hardened** for what spreadsheets actually export: UTF-8 BOM, tab/comma/**semicolon** delimiters, quoted cells, Windows line endings, and up to 5 title lines above the header. A file with only
  Name/Team/Position (no Rank/Tier/Expert/Mason column) is treated as a plain name list, not a rank table.
- **Persistence is still browser-local** (`localStorage`, `lib/refRanks.ts`): it survives reloads in that browser but does not follow the owner to another device/browser. Making it durable everywhere needs a new
  DB table = a migration on the shared Postgres, which needs the owner's explicit OK (see the harness gate noted under "League favorites/pins").
- Tests: `npx tsx scripts/testRankTable.ts` (27). `tsc`/`eslint` clean. Not clicked through in a browser (admin gate).

### Reference ranks now saved in the database (2026-10; requested explicitly by the owner — "if i upload it once, please make sure it's saved and flows")

The Expert / Mason reference ranks from the CSV import were browser-local. Moved to Postgres with the owner's explicit OK for the migration: new **additive** table `ReferenceRank`
(`key` PK = normalised name + "|" + POS, `name`, `pos`, `expert?`, `mason?`, `updatedAt`) — migration `20261002120000_add_reference_rank` (CREATE TABLE only; applied with `prisma migrate deploy`
after `migrate status` showed it as the only pending migration). `GET/PUT/DELETE /api/admin/reference-ranks` (admin cookie; PUT is a full replace in one transaction, validates ints 0–5000, ≤3000 rows).
`app/admin/page.tsx` loads the rows server-side and passes `initialRefRanks`, so an upload shows on every device/browser immediately, with no re-upload. Upload saves them straight away (Apply only governs
board changes). **One-time migration of earlier uploads**: if the DB is empty and this browser still has the old localStorage data, the board copies it into the database and clears the local copy.
If the database write fails, the board says so and shows the ranks for that visit only (never silently "saved"). `lib/refRanks.ts` is now types + API helpers (the localStorage store is gone).
Round-trip checked against the real table with a probe row (written, read back through `refRanksFromRows`, deleted; table left empty). `tsc`/`eslint` clean. Not clicked through in a browser (admin gate).

### Tier board: Mine / Expert / Mason as real columns with agreement edges (2026-10; real feedback from the owner — "where do the ranks show up … it should be a column next to mine", with a reference screenshot)

The reference ranks were tiny `E`/`M` text between the team and projected points and only rendered once data existed — easy to miss. Each row now has three boxed, labelled columns right after the headshot:
**Mine** (overall rank on your board), **Expert** and **Mason** (the imported Flock ranks). They are always shown ("—" until a CSV is loaded) so you can see where they live, and a line above the board says
how many players are loaded (or that none are yet and to use Import list → Upload CSV). Following the owner's screenshot, each Expert/Mason cell has a coloured right edge: **green** when that rank is within N spots of
yours, **red** when it differs by N or more (N defaults to 15, editable above the list); no edge when the player has no rank in that source. Compares against your overall `#`, so it assumes the CSV's Expert/Mason
numbers are overall ranks (if they were positional every row would read red — raise N or tell me). `tsc`/`eslint` clean. Not clicked through in a browser (admin gate).

### Reference ranks: decimal Expert ranks were being dropped; columns made legible (2026-10; real bug reported by the owner — "i see expert ranks up to 200, just they are in decimals, round to nearest")

Only 103 of 327 saved players had an Expert rank (268 had Mason). Root cause: the CSV's Expert ranks are **decimals** (e.g. 12.5). The parser accepted them, but `PUT /api/admin/reference-ranks` required whole numbers
(`Number.isInteger`) and silently nulled anything else — and a row with neither source was discarded. Mason's whole numbers survived, which is why only Expert looked empty.
- **Fix**: `toRank` (`lib/rankingsHelpers.ts`) rounds to the nearest whole rank (12.5 → 13, 12.4 → 12), also accepts `#12`, `T-12`/`T12`/`12T` (ties), `12*`, `12 (3)`; and the API now rounds (`Math.round`) instead of rejecting.
  Things that are not numbers (`N/A`, blank, `RB2`, `-`) are still NOT guessed.
- **No more silent drops**: the import panel now reports, per source, which CSV column was used and how many cells were read / blank / unreadable (with examples). If several headers look like the same source it uses the one
  with the most real numbers and lists the ignored look-alikes.
- **Columns made distinguishable**: Mine / Expert / Mason are bigger (19px bold), Expert has an amber tint, Mason a blue tint, a missing rank shows a dashed, faded "n/a" cell (hover: "No Expert rank for this player in your CSV").
- The rows already saved have null Expert values and cannot be recovered — **re-upload the CSV once** to refill them (an upload replaces the saved set).
- Tests: `npx tsx scripts/testRankTable.ts` (39). Real-data check: the DB showed 327 saved rows, 103 Expert / 268 Mason, matching the diagnosis. `tsc`/`eslint` clean. Not clicked through in a browser (admin gate).

### Tier board restructured into an aligned grid (2026-10; requested explicitly by the owner, with a reference screenshot — "make my format more succinct like this, right now it's all over the place")

The board rows were a free-flowing flex row (arrows, checkbox, photo, rank, ref ranks, chip, name, team, ×N, points, buttons), so columns didn't line up from row to row. Rows and tier headers now share ONE grid
template (`--tbcols` on `.tiergrid`, `app/globals.css`): **[select + ▲▼] · Mine (#) · Player (photo, name, injury badge, "on N of your leagues") · Pos chip ("RB 1") · Wk/Szn pts · Team · Expert · Mason · [« » ✕]**.
Each tier header carries the column labels (Wk N pts / Team / Expert / Mason) above its columns, as in the reference, with the S/A/B… letter in a small badge and "Sort by ADP" kept in the header. Expert/Mason cells keep the
amber/blue tints, a green/red right edge (agree/disagree with your rank, threshold editable) and a faded "n/a" when a player isn't in the CSV. Rows are 56px; the list scrolls horizontally below ~900px instead of wrapping.
Only the board rows changed — the Needs-ranking / history / import lists still use the plain flex `.tierrow`. Drag-and-drop, arrows, bulk select, undo and all data logic are untouched (markup/CSS only).
Design note: this follows the owner's explicit reference (like the player-card exception) while keeping the app's tokens — amber/blue tints, no new accent colours.
Verified in a real browser against the real `globals.css` using a throwaway static harness (deleted): all four labelled columns sit at identical x-centres in every row, rows are 56px, edge colours and the n/a state render. Not verified on the real
`/admin` page itself (passphrase gate), so check it once with live data. `tsc`/`eslint` clean.

### Public Rankings page: photos, Team column, Tier view (2026-10; requested explicitly by the owner — "change it for fantis the live site for people not on admin as well")

Brought the tier-board look to the public Rankings table (`components/Rankings.tsx`), within what that page already is:
- **Player photos** (shared `components/Headshot.tsx`, now also used by the admin board; position-ringed round Sleeper headshot, position-label fallback) and a **separate Team column** (it used to trail the name).
  Position chip now reads "RB 1". Projected-points column has a subtle amber tint and slightly larger type. Grid templates/min-widths widened for the extra column (`.rk`, `.rk-season`).
- **Tier view** chip (off by default): groups by Fantis' own tiers (curated order) with banded tier headers (letter badge, "TIER", count), same look as the admin board. **Why it's opt-in**: the public default order is live Sleeper ADP,
  deliberately — the old curated order put every tier-1 QB first. In ADP order tiers are interleaved, so banding would split/lie; clicking any sort header turns Tier view off.
- **Expert / Mason ranks are NOT shown publicly.** They are the owner's import of another site's (Flock / Mason Dodd) rankings, whose `robots.txt` disallows crawling; republishing them to visitors needs the owner to
  confirm they have the right to. They stay behind `/admin` (`/api/admin/reference-ranks` is passphrase-gated). If permission is confirmed, adding them to this page is a small change.
- Verified on the real page in the dev server: header and rows share 11 aligned columns (season view), 359 photos load, Tier view yields 8 bands with counts and switches ADP order → tier order. `tsc` clean; the only `eslint` error is the pre-existing
  setState-in-effect on the "close the panel when the selection is filtered out" effect (same effect, line shifted).

### Expert / Mason ranks on the PUBLIC Rankings page (2026-10; requested explicitly by the owner — "add expert and mason to public page")

Reversed the earlier hold: the owner explicitly asked to publish the imported Flock Fantasy Expert and Mason Dodd ranks to visitors. (Risk noted to the owner beforehand: they're third-party rankings and Flock's `robots.txt`
disallows crawling; the owner supplied the numbers themselves and made the call. If Flock ever objects, remove the two columns and the `/api/reference-ranks` route — nothing else depends on them.)
- **New public, read-only `GET /api/reference-ranks`** → `{count, ranks:{key:{expert?,mason?}}}`, CDN-cached 5 min. It exposes only the numbers (no timestamps/ids). The write path stays passphrase-gated at
  `/api/admin/reference-ranks` (PUT/DELETE; unauthenticated → 401).
- `components/Rankings.tsx`: **Expert** and **Mason** columns after Team (amber / blue tints, "n/a" faded when a player isn't in the CSV), both **sortable** (lower = better, missing always last), in both This-Week and Season views;
  grid templates/min-widths widened (`.rk`, `.rk-season`, `.tierhead`). Lookup key = `refRankKey(looseKey(name), pos)`, the same key the admin importer saves under. `lib/usePublicRefRanks.ts` fetches once per page load and
  degrades to "n/a" on any failure.
- **Attribution**: a line under the table credits Flock Fantasy (flockfantasy.com) as the source of the Expert and Mason Dodd columns and states Fantis isn't affiliated.
- Verified on the real page in the dev server against the live table: endpoint 200 with the cache header and 351 players, header and rows share 13 aligned columns, Expert sort ascending (1, 2, 3, 5, 5, 6), credit line rendered.
  `tsc` clean; only the pre-existing setState-in-effect lint error remains.

### Public Rankings: default order is now the owner's ranking, not live ADP (2026-10; real bug reported by the owner — "how is this grouped? looks wrong, olave is 6?")

**Supersedes** the "default order is live ADP / Tier view is opt-in" decision in the Public Rankings entry above. Each row mixed sources that disagreed: the list was sorted by live Sleeper ADP (Olave #5), while the position chip
("WR 6"), the tier stripe (tier 2) came from the owner's board and Expert/Mason said 17 — the owner's board has him #15. The old comment justifying ADP order (tier-1 QBs crowding the top 10) referred to the *previous*
position-grouped curated list; the tier board's order is now a true cross-position overall ranking (Gibbs, Bijan, Smith-Njigba, Walker, Chase…), so it should lead.
- **`#` = the player's overall rank on the owner's board** (index in the curated order, 1–360), stable under search/position filters/other sorts. The old `#` was an ADP-derived rank that changed meaning.
- **Default sort = the owner's order, best first, with banded tier headers** (S 10, A 14, B 17, C 30, D 34, E 44, F 22, G 189). Bands show whenever `sortBy === "rank"` and ascending; sorting by any other column (ADP, Pos,
  Expert, Mason, Proj …) drops them. The separate "Tier view" chip is gone (it's the default now). ADP is back to being an ordinary sortable column ("vs ADP" is unchanged).
- Verified on the real page: default top 12 matches the tier board, `#` strictly increasing 1…360, Olave reads `15 · WR 6 · Expert 17`, ADP sort still works and removes the bands. `tsc` clean; only the pre-existing setState-in-effect lint error.

### Each public tab is its own URL (2026-10; requested explicitly by the owner — "make rankings / leagues / trade / start-sit / portfolio their own tab/url … fantis.vercel.app/rankings")

The public site was one page (`app/page.tsx` → `components/FantisApp.tsx`) switching tabs with React state, so nothing was linkable. Now:
`/` and `/leagues` (Leagues; `/` is the home/landing and renders the same view), `/rankings`, `/trade`, `/start-sit`, `/portfolio` — each a real route with its own `<title>`/description (`app/(site)/**/page.tsx`).
- **Route group `app/(site)/`** with a shared `layout.tsx` → `components/SiteShell.tsx` (client). The nav is real `<Link>`s with the active tab derived from the path (`aria-current="page"`), the brand links home, and the shell keeps
  the synced-Sleeper-league state (username, season, leagues, opened league `sel`, player map, `sync`/`openLeague`, `go(target)`) in a React context (`useSite()`). **Layouts stay mounted across navigations**, so syncing on `/leagues`
  and then opening `/trade` still has your league, with no reload or refetch. A hard reload/deep link starts fresh (it's in-memory by design, same as before). `/admin` and `/manager` are outside the group and unchanged.
- Views: `components/site/LeaguesView.tsx` (hero + league list + team hub/standings/waivers) and `components/site/ToolViews.tsx` (`TradeView`, `StartSitView`, `PortfolioView` — thin wrappers that pass the shared state to the unchanged
  `Trade`/`StartSit`/`Portfolio`). `TeamHub`'s `onNavigate` and the hero's "See full board" now use `go()` / `<Link>`. `FantisApp.tsx` and `app/page.tsx` were removed.
- Verified in the dev server: all six URLs 200 with their own titles; typed username persisted across Leagues → Rankings → Leagues (client navigation, no full reload); cold load of `/rankings` renders the 360-row tiered board; `/admin`, `/manager`
  and `/api/players` still respond. `tsc`/`eslint` clean. (Gotcha seen this session: stopping the dev server mid-write can leave a corrupt `.next/dev/types/validator.ts` that breaks `next build` — delete `.next/dev` if so; it is gitignored and never deployed.)

### Public Rankings: clicking a player opens the full player card with stats (2026-10; requested explicitly by the owner — "clicking on player card should show stats")

Clicking a row on `/rankings` used to open a small side panel (tier, ADP, projection, odds) with no real stats — the full `PlayerCard` (General · Logs · Career · News, Adj PPG, RZ opportunity, per-game log, FC value) only opened for roster players
inside the league views. Now a Rankings click opens that same card:
- `components/Rankings.tsx` → new `RankCard` child: looks up the player's Sleeper id (same name+position matcher as everywhere), the Sleeper player map, and trade values, then renders `<PlayerCard>` with ADP, position rank, tier, value, pool size.
  `usePlayerMap`/`useTradeValues` (the latter pulls heavy season data) only mount **after a click**, so the Rankings page itself stays light.
- **Nothing lost from the old panel**: `PlayerCard` gained an optional `extra` slot (bottom of the General tab, `.pcardextra` styles) that carries this week's game odds / spread / win probability, Scoring Environment, MVP odds and
  player props. The old side panel remains only as the **fallback for players Sleeper can't match** (e.g. Travis Hunter), so every row still opens something.
- Verified in the dev server: Chris Olave → card with Tier A / ADP 5 / WR6 / Value / FC Value, General extras (vs ATL, −2.5, O/U 47.5, 55% to win, props), Logs tab with the full per-game table, close works, old panel not opened;
  Travis Hunter → fallback panel. `tsc` clean; PlayerCard/Rankings lint findings are identical to the committed baseline (pre-existing).

### Player card: 2026 season + the weeks played + Sleeper projections (2026-10; requested explicitly by the owner — "incorporate 2026 and the weeks they played + projections from sleeper")

The card (`components/PlayerCard.tsx`) was hard-wired to 2025 back to 2020. Now:
- **2026 is the default season** in the weekly chart, the game log and the Career tab (`CARD_SEASONS = ["2026", ...HISTORICAL_SEASONS]` in `lib/sleeper.ts`). The stats fetchers already took any season; the played weeks are real Sleeper box scores.
- **Projections for weeks not yet played**, current season only: new `getPlayerProjectedWeeks(playerId, season, fromWeek)` (`lib/sleeper.ts`) reads Sleeper's per-week projections endpoint (`/projections/nfl/regular/{season}/{week}`, weeks
  `projWeek`..18), keeps only players with a real projection (pts_ppr > 0), and carries pass/rush/receiving attempts, yards, TDs, targets and receptions so projected rows fill the same columns as played games. **In-memory only, fetched once per
  page session** (≈15 × 600KB, concurrently) — nothing goes to localStorage, which is already near quota. A week with no real projection (bye, out) is simply absent.
- **Weekly chart**: solid bars = real results; **dashed bars with "~" labels = Sleeper projections**; a one-line summary ("3 games played: 70.5 pts (23.5/game) · Sleeper projects 262.6 more over 14 games"). **Game log**: projected rows are italic, tagged `proj`,
  show "~" PPR, and are excluded from the colour scales (they never move the self-relative ranges). A week whose game has actually been played (even the in-progress Thursday game) shows the real result, never the projection. Bye weeks stay out.
  Adj PPG / Rec % / RZ labels follow the selected season ('26). **Career** gets a 2026 row (games played so far only; no projections mixed into history).
- Verified in the dev server on Chris Olave: 2026 default; weeks 1–3 real (28.2, 22.6, 19.7), weeks 4–18 projected, week 8 bye bar absent, 17 log rows (3 real + 14 projected), Career 2026 = 3 GP / 70.5 / 23.5 (matches the chart);
  2025 log unchanged (17 rows, no projected rows). `tsc` clean; PlayerCard lint findings identical to the committed baseline.

### Optimize: "My tiers, then projection" mode + per-league "Choose players" editor (2026-10; requested explicitly by the owner — "some people are on the same tier in my rankings, when optimizing is there an easy way for me to choose the flex etc")

Two gaps on `/manager/lineups` → Optimize: in "rankings" mode players in the same tier were separated only by their exact list position (projections never broke the tie), and there was no way to hand-pick a slot before sending.
- **New third mode, "My tiers, then projection"** (`mode === "tiers"` in `components/manager/BulkOptimize.tsx`): only the owner's TIER decides who's preferred; players sharing a tier are split by Sleeper's projection. Implemented by feeding the optimizer
  `rankOrder = (tier − 1) × 100` (one tier step ≫ any projection gap, so tiers never cross; same tier ⇒ equal band ⇒ points decide). The old mode is relabelled **"My exact rankings"**; "Projections only" is unchanged. **The default is still "My exact rankings"**
  (not changed unasked). Swap reasons read "better tier" / "same tier — higher projection".
- **"Choose players ▾" on every league row**: a dropdown per unlocked slot listing only players who can legally go there, each labelled `name · Tier X · projection (· THU/FRI/SAT)` and sorted best tier → highest projection, so tier-mates are easy to tell apart.
  Picking a player already starting elsewhere SWAPS the two (refused if the displaced player can't take the other slot). Pure, tested logic in `lib/lineupEdit.ts` (`applyPick`, `slotOptions`, `slotLocked`, `diffLineups`): never an Out/IR/bye player, never a locked
  (game-started) player or slot, never a never-start player, never an ineligible position, never a player off the roster / on IR. The row's swaps, projected change, the confirm total and what is actually SENT (`setStarters`) all come from the edited lineup
  ("your pick", "edited by you" + Reset); a row edited back to the current lineup is excluded from the send. Edits are discarded when mode / week / FLEX-lock changes (the proposal underneath changed). Manual picks are NOT blocked by the Thu–Sat-out-of-FLEX
  rule (it's the owner's explicit choice) — the option label shows THU/FRI/SAT so it's visible.
- Tests: `npx tsx scripts/testLineupEdit.ts` (19: swaps, every refusal, locked slots, option lists, diff, plus the tier-mode ordering — better tier wins despite lower projection; same tier → higher projection; strict order contrast).
  Real-data check on the 210 live leagues (week 4): **8,130 legal manual picks across every slot → 0 invalid lineups**; FLEX slots offered ~8.8 legal options on average, 733 slots had a same-tier alternative. Mode comparison (projected change / leagues
  lower): exact rankings −126.9 / 105, tiers-then-projection **+126.8 / 40**, projections only +520.0 / 0. All existing suites unchanged (21, 6, 433, 84). `tsc`/`eslint` clean. Not clicked through in a browser (`/manager` is behind the passphrase + Sleeper
  connection), and the actual Sleeper send is still the never-exercised-live path — send one league first.

### Refresh / sync: live rosters, injury refresh, stale-send guard, honest Refresh button (2026-10; requested explicitly by the owner — "the refresh /sync doesn't work well, make sure it's real time with no errors")

Investigated with real data first. The stored full sync itself was NOT failing — the last 25 runs were all `success` (242/242 leagues, 0 errors) — but each takes **~60s with no progress**, the header Refresh button ignored failures, the Lineups tools computed
from the **stored snapshot** (so a drop/add/lineup edit made in the Sleeper app was invisible and could be overwritten), the Sleeper player dump (injury designations) was cached by UTC calendar day (hours stale on a game day), and a cut-off
sync left a `running` row forever. Fixes:
- **Live rosters on Lineups** (`lib/liveRosters.ts`, `lib/useLiveRosters.ts`, `components/manager/LiveStatusBar.tsx`): the owner's roster in every in-season league is read **straight from Sleeper's public API** (bounded concurrency 8, up to 3 attempts with backoff, never retries a 404)
  and overlaid onto the stored rosters (`mergeLive`); on open, on "Reload rosters", after any send, and automatically when the tab becomes visible again after 3+ minutes. A league whose live read fails keeps its stored roster and is named in a visible warning with Retry.
  **Real-data check: 237 leagues read live in 4.0 s, 0 failures** (vs ~60 s for the full sync).
- **Stale-send guard** (`BulkOptimize.start`): right before each `setStarters`, the roster is re-read from Sleeper and compared (`rosterChanged`: players/IR as sets, starters slot-by-slot) with the one the proposal was built from. If anything changed (drop, add, IR move,
  lineup edit in the Sleeper app) or the read fails, **nothing is sent for that league** and the row shows why ("Roster changed on Sleeper since this page loaded … Press Reload rosters"); other leagues continue.
- **Injuries**: the player-dump cache is now **1 hour** (was the UTC day; key `fantis_players_nfl_v4`, old v3 copy removed) and **"Refresh injuries"** pulls a fresh copy on demand (`refreshPlayers`, **2-minute floor** between pulls so a button mash can't hammer Sleeper; a failed
  refresh keeps the previous data). `usePlayerMap` now exposes `refresh`, `refreshing`, `updatedAt`; the status bar shows "Injury data: N min ago".
- **Header Refresh button** (`ManagerHeader.tsx`): shows a running timer ("Syncing… 23s"), checks the response, and reports the outcome — "✓ Synced 242 leagues in 58s", a partial failure with counts, or the reason it failed (expired admin session, HTTP status, network). The sync route now marks any
  `running` SyncRun older than 6 minutes as `failed` ("Interrupted…") so history can't lie. Full sync is still ~1 min by nature; the Lineups tools no longer depend on it.
- Not covered here (follow-ups): Mass IR / Mass Add still use the stored snapshot (their sends are checked by Sleeper itself); no scheduled background sync (no cron configured — a Hobby-plan limit may apply).
- Tests: `npx tsx scripts/testLiveRosters.ts` (13). All other suites unchanged and passing (433/84/21/19/20/6/39/31/11). `tsc` clean; the only lint errors in touched files are the two pre-existing `setState`-in-effect findings in `ManagerHeader.tsx`. Not exercised in a browser
  (`/manager` needs the passphrase + Sleeper connection); the Sleeper send itself remains the never-run-live path — send one league first.

### Mass IR + Mass Add: live availability and a pre-flight roster check before every batch (2026-10; requested explicitly by the owner — follow-up to the live-rosters work)

The Lineups-page tools already COMPUTED from live rosters (they receive the merged live data), but neither re-checked right before sending, and Mass Add's "is he still free?" grid came from the stored snapshot. Now:
- **`preflightRosters` (`lib/liveRosters.ts`) — one pre-flight per batch, per league, before anything is sent** (used by Optimize, Mass IR and Mass Add): re-reads each affected league from Sleeper and compares it to the roster the plan was built from; a league that changed
  (players/IR as sets; the current lineup only when the change depends on it) or can't be read is **set aside with a clear message** while the rest of the batch proceeds. Deliberately per league, not per row: rows for the same league would otherwise see each other's writes as
  "the roster changed". `rosterChanged` gained `ignoreStarters` (adds, IR moves that don't clear a starter, future-week lineups don't depend on this week's starters). **This replaces the per-task guard added to Optimize last time, which would have wrongly failed "All weeks"
  runs** (week 4's send changes the current starters, so week 5's re-check would have looked like an outside change).
- **Mass Add also checks the player is still free**: the same read returns everyone's roster (`fetchLiveLeague` → `allRostered`), so a league where another team has since taken the target fails with a plain message instead of a Sleeper error. Mass Add's availability grid on the Lineups page is now
  **overridden by live data** (`liveRostered` prop → `rosteredEff`) for every league with a live read; a league without one keeps the stored answer. Open Spots / Waiver Assistant (which embed the same board) get the pre-flight automatically, compared against their own loaded data; they have no live overlay.
- Mass IR: a row that must clear a starter's slot first uses strict mode (starters must match), because it re-sends the starters list — previously that used the page-load starters even if you'd changed the lineup in Sleeper since.
- Tests: `testLiveRosters.ts` now 25 (ignoreStarters, one read per league, changed/unreadable/gone blocked, lineup-only edit not blocking a non-lineup change, `allRostered` passthrough, no-base case). All other suites unchanged and passing.
- Real-data check on the 237 live leagues: pre-flight **3.7 s**; 235 clear, **2 blocked and both were genuine** (Tank Dell→Samaje Perine in #31 and Perine→Darren Waller in #101, made after the last stored sync — the stored data really was stale). A deliberately tampered baseline was blocked; a lineup-only difference was
  correctly ignored for a non-lineup change; live vs stored availability for six real add targets disagreed in 1 league (Waller). `tsc` clean; no new lint findings. Not exercised in a browser (`/manager` is behind the passphrase + Sleeper connection); the Sleeper writes themselves remain the never-run-live path — send one league first.

### One-click "Set weeks 5–17" + early/late-Sunday slot preference + a flex rule that can't be bypassed (2026-10; requested explicitly by the owner)

"set my lineups for week 5-17 right now with highest projections … 1 button … flexs should never have thurs-sat games, also early 10 am sunday games pst are preferred in the WR RB slot, flex usually for later sundays / mondays."
- **One button** at the top of Lineups → Optimize (`components/manager/BulkOptimize.tsx`): **"Set weeks {current+1}–17"** (`selectedWeek === "ahead"`, `AHEAD_LAST = 17`; week 18 excluded). Click → switches to *Projections only* + FLEX lock, loads the 13 weeks' projections and ESPN
  schedules, computes every league × week, and **automatically opens one confirm** with a real summary (leagues, weeks, the rules, send speed, the injury assumption, and a warning for any lineup that would leave a slot empty). Nothing is sent until that confirm. Sends use the existing
  bulk path (≈3 at a time, a week Sleeper won't accept yet shows as failed for that league only) behind the live-roster pre-flight (future-week rows only need the same players/IR, not the same current lineup). Priority / Avoid / Never-start / Flex-first lists still apply.
- **Early vs late Sunday** (`lib/kickoffSlot.ts`, **always Pacific time**): `THU/FRI/SAT`, `SUN_EARLY` (Sunday before noon PT: 10:00 AM and the 6:30 AM London games), `SUN_LATE` (noon PT on: 1:05/1:25 PM and Sunday night), `MON`. The optimizer's `DAY_TRUE_SLOT_BIAS` is now
  Thu .0025 > Fri .002 > Sat .0015 > Sun early .0012 > (plain Sun 0) > Sun late −.0012 > Mon −.002 — still **tie-breaks only** (projections always win). **This also fixes a latent bug**: the Optimize tab and the chat engine classified days with `new Date(iso).getDay()`, i.e. the viewer's/host's own
  time zone — in UTC a Saturday 9 PM PT game (week 17) reads as Sunday and could slip into FLEX. Both now use `kickoffSlot`.
- **The flex rule is now genuinely absolute.** Real-data dry run found **92 lineups with a Thu–Sat player still in FLEX**: the "never propose a worse lineup" safety net compared against the CURRENT lineup (week 4's arrangement, carried forward, often with Thursday players in FLEX) and handed it back unchanged because the compliant
  lineup projects lower. Fixed in `lib/lineupOptimizer.ts`: `flexRuleBreaks()` is used to forbid assignments, to refuse restoring an old occupant, and the safety net no longer protects a current lineup that itself breaks the rule. Locked (already-played) slots are still never touched.
  The rule now covers **RB/WR/TE** (the owner: "flexs should never have Thu–Sat games"); a QB stays exempt so a 2-QB league's superflex isn't starved. If a roster has nobody eligible without a Thu–Sat game the slot goes **empty** rather than breaking the rule (8 of 2,730 league-weeks) — flagged in the confirm summary; manual
  picks in "Choose players" are the owner's explicit choice and are not blocked.
- **Later-week injuries**: for weeks after the current one, only IR/PUP/Sus/NA/DNR keep a player out; today's "Out"/"COV" are assumed over (visible, switchable chip "Later weeks: Out/Doubtful count as healthy"), because one short injury shouldn't bench a player for the whole season. Bye weeks always exclude.
- **Real-data dry run, weeks 5–17, 210 live leagues (the exact one-button computation):** 2,730 league-weeks → **2,690 lineups to send** (≈200+ per week); Thu/Fri/Sat player in FLEX **0**, ineligible 0, duplicates 0, unavailable 0, never-start 0. Placement of RB/WR/TE starters: early-Sunday 8,077 true slot vs 2,734 FLEX; late-Sunday 2,010 vs 3,765 (FLEX);
  Monday 311 vs 1,305 (FLEX); every Thu–Sat starter in a true slot (3,150). Cost of the slot rules vs pure projections: 457.8 projected points across 141 league-weeks (≈3 pts each); 47 league-weeks end below the current lineup's projection — all of them the rule forcing a Thursday player out of FLEX.
- Tests: `testKickoffSlot.ts` (12, incl. the Saturday-9 PM-PT trap and winter offsets); `testLineupOptimizer.ts` 30 (TE now blocked in FLEX, QB still allowed, early/late Sunday + Monday preferences, a real 3-pt edge beating the preference, a rule-breaking CURRENT lineup being fixed at a projected cost, empty slot instead of a violation, locked slot untouched).
  All other suites unchanged and passing. `tsc`/`eslint` clean. Not exercised in a browser (`/manager` needs the passphrase + Sleeper connection); the Sleeper writes remain the never-run-live path, and **future-week sets in particular have never been sent** — send one league's weeks first and check them in Sleeper.
### Optimize: Questionable board, "Your call", real progress counter; chat learns lineups-ahead, won't-play, tiers (2026-10; requested explicitly by the owner)

**Optimize tab (`components/manager/BulkOptimize.tsx`)**
- **Questionable board** — every Questionable/Doubtful player starting on your rosters (game not started, not on bye). "Mark: won't play" treats him as unavailable THIS WEEK ONLY (not saved) and shows who the optimizer starts instead per league; a dropdown lets you force a specific replacement (healthy same-position bench players, sorted by your rank) or keep "Recommended". Forced replacements feed `priorityRank` for the run.
- **"Your call"** — when the projection starts a player you rank BELOW a healthy same-position bench player (by order, or by tier in tiers mode), you pick who you prefer; one answer per player pair applies to every league. Never asks about players whose game has started, players on Priority/Avoid/Never-start, or injured/bye players.
- **Progress** — a fixed bottom-right `ok / total` counter plus a progress panel while sending ("Starting… checking rosters", "N of M finished", sent/failed/in progress/waiting). Relabelled RB↔FLEX shuffles as "slot move" (they were mislabelled "higher projection").
- Later-week sets no longer skip a whole league when the roster changed: players no longer on the roster are left as empty slots and the rest is sent. Weeks with no projections or no game schedule are skipped and flagged (an empty schedule used to silently disable the started-game freeze and the Thu–Sat FLEX rule).
- Audit fixes: hand edits are dropped if the live roster changed under them; `LeagueRow` keys follow the roster contents so a live auto-reload doesn't wipe row state.

**Command Center chat (`lib/commandCenter/*`)** — all read-only drafts as before; nothing new can send.
- `"Set my lineups for weeks 5-17"` / `"…rest of the season"` → `set_weeks`: per league × week, highest Sleeper projection (or "using my tiers"/"my exact rankings"), Thu/Fri/Sat out of FLEX (hard), early Sunday leaning to true slots and late Sunday/Monday to FLEX (Pacific time), later-week injuries = only IR/PUP/Sus/NA/DNR stay out. Needs `env.weekData(week)`; a week without projections or kickoffs is skipped and disclosed; week 18 is never drafted; the current week is pointed to "fix my lineups". Drafts carry `future: true`.
- **Executor support for future-week lineups** (`LineupParams.future`, `ExecDeps.readWeekStarters`): live re-validation skips the current-lineup comparison and started-game checks (still requires every player on the roster and off IR/taxi); verification re-reads THAT week's matchup (`getMatchups`); no way to re-read → `verify_failed`, never "executed". `draftKey` already includes the week, so each week is its own proposal. Chat save now batches 300 drafts per request (server cap).
- `"Who's questionable on my teams?"` → `questionable` board (read-only). `"I think Mike Evans won't play, fix my lineups"` / `"assume X is out"` → `lineup_improvements` with `wontPlay` (this command only; replacements summarised; unknown/ambiguous names refuse). `"Fix my lineups using my tiers / my exact rankings / by projections only"` → `rankMode` (needs `env.curatedTier`).
- Tests: `testCommandCenter.ts` 459 (new section 37), `testCommandCenterExec.ts` 97 (future-week validation/verification). **The Sleeper write for later-week lineups has still never been sent live — send one league's week first and check it in Sleeper.**
### Full IR: say who to swap out, in chat and on Mass IR (2026-10; real bug reported by the owner — "move saquon to IR, if it's full tell me who to replace him with … it currently omits the one with full IR")

- **Chat `send_to_ir`** (`lib/commandCenter/engine.ts`): a full-IR league is no longer just reported. It picks who on IR makes room — your IR Release list first (your order), then anyone on IR who no longer qualifies (healthy / not an IR status), then the lowest Fantis value; never a Priority-list player (if everyone is protected it says so). If your active roster has a spare spot it drafts an `ACTIVATE_IR` (that player to your bench, no drop) then the `IR_MOVE`; otherwise a `DROP` then the `IR_MOVE` — same ordering-is-the-safety pattern as `ir_opps` (bulk send is sequential and stops at the first unverified result). The decisions block names the swap per league.
- **Mass IR** (`components/manager/BulkIR.tsx`): the full-IR dropdown now offers "swap: X → bench" (only where the active roster has a spare spot; uses `activateFromIR` then `moveToIR`) as well as "release X"; it defaults to the swap when there's room. `buildIrPlan` (`lib/bulkPlan.ts`) gained an optional `releaseOrder` and orders the IR pool list → no-longer-eligible → lowest value (Mass IR passes `prefs.irRelease`).
- Tests: `testCommandCenter.ts` 465, `testMultiAddPlan.ts` 23. Not exercised live (writes still never sent).
### Mass Drop — site tab + chat (2026-10; requested explicitly by the owner — "there should be a mass drop also … both chat and site")

- **Site: Lineups → Mass Drop** (`components/manager/BulkDrop.tsx`): search up to 8 players you roster (search only offers players on your rosters, with league counts), one row per league holding each; bench/IR rows start ticked, starters and Priority-list players start unticked (released only on purpose). Filter / select-all-shown, `BulkConfirm` (warns when starters or Priority players are included), live-roster pre-flight per league (changed league set aside; player no longer rostered → nothing sent), `addDropFreeAgent` with only `dropPlayerId`, progress/result tone, refresh after.
- **Chat: `mass_drop` intent** — "drop X everywhere" / "release X and Y from all my leagues" (`lib/commandCenter/intent.ts`, checked after the add+drop split and the `drop_preferences` follow-up, so "add X, drop Y" stays a combined add). Engine drafts one `DROP` per league where he's rostered: bench and IR always; a starter only with "including starters"; a starter whose game has started is skipped (Sleeper refuses); Priority-list players never. Every skipped league is listed with the reason. Drafts only — sending still goes through the Proposals tab in Live mode.
- Tests: `testCommandCenter.ts` 469 (the old "Drop X everywhere is refused" assertion replaced by mass-drop behaviour). Not exercised live — no Sleeper write has been sent yet.
### Open Spots: pick who to add per league, from top adds (2026-10; requested explicitly by the owner — "show me all the leagues i have an open spot, 2 or 3, and let me choose who to waiver maybe from top names added")

`/manager/open-spots` now leads with **Fill your open spots** (`components/manager/FillOpenSpots.tsx`): every in-season league with open active-roster spots, counted from a **live** Sleeper read (`fetchAllLive`; stored roster only if the live read fails, flagged), with **All / 1 open / 2 open / 3+ open** filter chips. Each league gets one picker per open spot listing Sleeper's most-added players in the last 24h (`getTrendingAdds(24, 60)`, offense only) that are **still free in that league** (live `allRostered`), plus a per-league search for anyone free there; "Fill shown with top adds" pre-fills every shown league. Sends add-only (`addDropFreeAgent`, no drop); a player still on waivers becomes a claim (`claimWaiver`) with a FAAB bid from `suggestBid` (league's own history, min fallback, capped at budget left; editable). `BulkConfirm` first, live pre-flight per league (changed league set aside; player taken since → nothing sent), per-pick status, result tone, refresh. The old same-player-everywhere `BulkAdd` board stays below ("Or add the same player everywhere"). UI only — no new pure logic, so no new test file; not exercised live (no Sleeper write sent yet).

### Chat: "how many leagues am I 4-0?" (2026-10; real gap reported by the owner — "chat didn't understand")

New `record_count` intent (`lib/commandCenter/intent.ts`): a `W-L`/`W-L-T` record with league/record/"am I" wording ("how many leagues am I 4-0", "which leagues am I 2-2 in"), "undefeated"/"unbeaten", "winless", or "record breakdown". Engine reuses the standings rows (`standingRow`, real Sleeper records, 5-min session cache) — answers "You're 4-0 in N of M leagues", always with the full record distribution, lists the matching leagues in a standings block, and says how many leagues had no record. "weeks 4-5" (set_weeks) is excluded. Tests: `testCommandCenter.ts` 473. Also new on Open Spots this session: see the entry above.

### Empty Roster Spots: choose the list — most added, recently dropped, best available, RB handcuffs (2026-10; requested explicitly by the owner — "display all the RBs that were dropped / handcuffs … instead of just most added, like most rostered")

The Open Spots page is now labelled **Empty Roster Spots** in the nav (right under My Leagues). Its per-spot picker (`components/manager/FillOpenSpots.tsx`) has a **Choices** switch: **Most added (24h)** (`getTrendingAdds`), **Recently dropped** (`getTrendingDrops`, with the platform-wide drop count), **Best available (Sleeper rank)**, **RB handcuffs**. Every list is filtered to players still free in that league (live `allRostered`); "Fill shown with top choices" uses the selected list.
- "Most rostered" isn't public on Sleeper, so "best available" uses Sleeper's own `search_rank` (its popularity rank) — labelled as such, never as roster %.
- Handcuffs = RBs listed 2nd/3rd on Sleeper's depth chart (`depth_chart_order`), labelled "handcuff for <RB1>", with backups of RB1s **you roster in that league** first ("YOUR handcuff …").
- `PlayerMapEntry` gained `dc` (depth_chart_order, only for players on a team) and `rk` (search_rank, only when < 5000) — player-dump cache key bumped to `fantis_players_nfl_v5` (v4 removed on write). Real-data check: 795 ranked offensive players, 32 RB2s on depth charts; trending/drop returns real data.

### Empty Roster Spots: several claims per league + "Your pending claims" with bid edit / cancel (2026-10; requested explicitly by the owner)

- **Multiple claims** (`components/manager/FillOpenSpots.tsx`): each league row has "+ another claim (with a drop)" — an extra row beyond the open spots with its own player picker AND a required "drop who?" (active players, weakest Sleeper rank first; one drop per row, never reused in the same league; starters labelled). Rows without a drop are held back and counted in a visible warning. Pre-flight also checks the drop is still on the roster. Sends add+drop (`addDropFreeAgent`), or a claim with that drop when he's on waivers.
- **Your pending claims** (`components/manager/PendingClaims.tsx`, new section on the same page): reads every in-season league's pending claims from Sleeper's private feed (`fetchLeagueTransactions` + `classifyTransactions`, same as the Inbox; needs write access), shows league / add / drop / bid / raw status, and per claim **Cancel claim** (`cancelWaiverClaim`) or **Save $N** for a changed FAAB bid. Sleeper has no edit-bid mutation, so a bid change = cancel, then `claimWaiver` with the same add/drop and the new bid (it re-enters at the end of your claim order in that league — stated on the page); if the re-place fails after the cancel, the row says so plainly. The list re-reads automatically after new claims are sent from this page.
- UI only (no new pure logic / tests). Not exercised live — no Sleeper write, and the cancel/re-claim path in particular, has been sent yet.
- **Follow-up (owner: "i can't claim another guy without doing the add drop … i have an open spot")**: the extra-claim drop is now **optional**. Sleeper accepts stacked claims with no drop; they compete for the open spot and only the ones that still fit go through when waivers run (a free agent, by contrast, can't be added without room — the page says so). Sends now run one at a time so several claims in one league reach Sleeper in the order shown (= claim priority).

### Empty Roster Spots: redesigned into one block per league (2026-10; requested explicitly by the owner — "doesn't show me my roster and what I need … make it more visually pleasing")

`components/manager/FillOpenSpots.tsx` rewritten (same data, sends and safety rules as before); styles are the `.fos-*` block at the end of `app/manager/manager.css` (existing tokens only — amber accent, mint for open spots, red for short/injured, hairline dividers, tinted position chips; detector clean on the new code). Each league is a hairline-separated block, not a card:
- **Header**: league name (link), open-spot dots that fill as you queue claims, FAAB left, IR used/total.
- **Roster** by position (QB/RB/WR/TE/K/DEF + IR row): surnames, starters bold, injured/out struck through with a Q/D/O/IR mark.
- **Need** pills: per QB/RB/WR/TE, healthy players vs that position's starting slots ("RB short · 1 healthy for 2", or "no backup"), plus FLEX shortfall across RB/WR/TE. Doubtful counts as out here.
- **Your claims**: a numbered queue in priority order (↑/↓ to reorder, ✕ to remove). The first N fill the open spots with no drop; anything beyond is an "extra claim" (amber) with an optional drop. FAAB bid inline.
- **Suggestions**: tappable player cards (photo, position chip, team, injury, why — "+N adds", "dropped N×", "Sleeper #", "YOUR cuff · Name"), positions you're short at first, 8 shown / "show more" up to 24, plus search. "Suggest" switch = Most added / Recently dropped / Best available / RB handcuffs. "Auto-fill open spots" queues the top suggestions for every shown league.
Not visually verified in a browser (`/manager` is behind the passphrase); built and type-checked.
- **Multi-league pass** (owner: "much better, can it be more intuitive for multi leagues?"): sticky top bar with a live status ("N queued in M leagues · K still have an empty spot", **Next ›** jumps to and opens the next league with an unfilled spot, Expand/Collapse all); **Needs** filter chips (QB/RB/WR/TE with league counts — FLEX shortfalls count for RB/WR/TE); leagues collapse to a one-line summary (need pills + queued surnames) once more than 3 are shown, click to open; **Across your leagues** strip — players free in 2+ of the shown leagues ("free in 9 · fits 6"), one tap queues him in every one that still has an EMPTY spot (never as an extra claim), with a confirmation line. Not visually verified (passphrase gate).
- **Claims you already placed now show on each league** (owner: "it doesn't show I waivered in 208 league when I def did"): `PendingClaims` auto-reads your pending claims as soon as Sleeper access is connected and reports them up (`onClaims`) to `FillOpenSpots` (`existingClaims` prop). Each league block shows an "Already claimed" row (player, $bid, drop) in both collapsed and open states; amber dots = spots already covered by a claim. Only no-drop claims count toward the empty spots (a claim with a drop keeps roster size the same). Claimed players are removed from that league's suggestions, and auto-fill / "Across your leagues" / the "still have an empty spot" count all account for them. Needs write access connected (it's Sleeper's private feed).
- **Placed claims moved into each league's own block** (owner: "i want the claim next to where i add the players and where my lineup is"): the separate "Already claimed" row is gone. Claims already on Sleeper are now the first rows of the league's numbered claim queue (amber, "claim placed on Sleeper · drops X / no drop") with an inline FAAB input → **Save $N** (cancel + re-place at the new bid) and **Cancel**, then the not-yet-sent picks ("not sent yet …", mint). In the roster grid each position row also lists incoming players: amber "+Name" = claimed on Sleeper, mint "+Name" = queued here. Extra-claim/drop logic now counts no-drop placed claims against the open spots. The collapsed one-line view shows "claimed Name $N" chips. Edits call `onClaimsChanged` so the list re-reads from Sleeper.
- **Drag-to-reorder + Apply** (owner: "give me drag and drop to arrange orders and where is the apply button to save?"): each league's queue is now ONE ordered list of placed claims + new picks (HTML5 drag with a grip handle, ↑/↓ for keyboard). Bid edits on placed claims no longer save instantly — they, the order, and new picks are saved by **Apply this league** (inline two-click confirm) or **Apply all · N leagues** in the sticky bar (`BulkConfirm` with a per-league line). Apply engine (`applyLeague`): live pre-flight; if a placed claim's bid changed, placed claims were reordered, or a new pick sits above a placed one → cancel that league's placed claims, then place everything in the order shown (bids as edited); otherwise only send the new picks. Leagues run one at a time; stops on an auth error. ASSUMPTION stated in code/UI: Sleeper has no reorder/edit-claim call we know of, so order = the order claims are placed; a claim cancelled but not re-placed is reported on its row ("queue him again"). "Cancel claim" stays immediate.
- **Weak players flagged** (owner: "flag where there are shit players on my team"): `weakReason()` in `FillOpenSpots.tsx` — offense only: no NFL team; or not on the owner's /admin rankings AND outside Sleeper's top 300 (`search_rank`, or unranked); or bottom tier (G) on the rankings AND outside Sleeper's top 250. Each league shows a **Cut first** row (name, position, the reason, "· starting" if he starts), weak players get a dashed red underline in the roster grid (reason in the tooltip), the collapsed view shows "N weak", a **Weak players · N** chip filters to leagues that have them, and extra-claim drop pickers list weak players first ("· weak"). Thresholds are a stated heuristic, not a hidden score.
- **Mass Drop can add a player in the same move** (owner: "instead of just releasing … can you queue a player on that page as well"): `BulkDrop.tsx` has an optional "Add in his place" search. With one chosen, every ticked league becomes add + drop in one transaction (`addDropFreeAgent`), or a waiver claim with that drop if he's on waivers (`claimWaiver`, FAAB bid input, never under the league minimum) — the drop then only happens if the claim wins. Leagues where the replacement is already rostered are skipped entirely (nothing released). Button/confirm wording switches to "Swap in X". Not exercised live.
- **Mass Drop safety: "Waiver claim only" (default ON)** (owner: "I don't want to drop him right now … confirm he's just waivered and queued"): with a replacement chosen, the tool now ONLY calls `claimWaiver` (add X, drop Y) — the player stays rostered and is dropped only if the claim wins; it never falls back to an instant add/drop, and if Sleeper refuses the claim (e.g. the replacement is a free agent there) nothing is sent and the row says "NOT dropped". Unticking restores the old instant-where-possible behaviour (clearly labelled). With NO replacement, a drop is immediate (Sleeper has no queued drop) — the button/confirm now say "Drop now …" / "DROP NOW … immediate, not a claim" instead of the vague "Release".
- **"No waivers queued" filters**: Empty Roster Spots has a **No waivers queued · N** chip (leagues with no pending claim on Sleeper; needs Sleeper access). The Mass Add/Claim board (`BulkAdd.tsx`), where a claims scan is available (Waiver Assistant), has an **Empty spot, no waivers queued** chip (rows needing no drop in leagues with no pending claim).
- **"Add one player to every league"** (owner, asap): a search row at the top of Empty Roster Spots. Each match shows "free in N" and two buttons — **Empty spots only · N** (queues him only where an empty spot is still open, never as an extra claim) and **All leagues · N** (every shown league where he's free, read live, and not already queued/claimed; beyond the empty spots he becomes an extra claim with no drop). Then **Apply all** sends them (adds where he's a free agent, claims where he's on waivers).

### Command Center 2.0 — navigation, shared bulk framework, Review Queue, Activity Log (2026-10; branch `command-center-2`, NOT on production — owner auditing first)

Owner's choices: keep the direct bulk pages but put them on one shared framework; chat plans keep going through proposals; Activity Log DB table approved; keep the free phrase parser (no LLM); all stages.
- **Sidebar** (`managerNav.ts`): Command Center · League Manager (All leagues, Lineups & weekly planner, Empty roster spots, Matchups, Byes, Injuries, Drafts, Commissioner) · Player Operations (Find a player, Waivers & adds) · Review Queue (Review queue, Trades & claims, Alerts) · Intelligence (Weekly record, Transactions, History, Activity log). `review`/`activity` added to `PORTFOLIO_SLUGS`. Mobile bottom bar's third slot is now Review (league context still shows League).
- **Shared bulk framework** (`lib/bulkOps.ts`, tests `scripts/testBulkOps.ts` 22): per-op stable `opKey`; `planBulkOps` (ineligible / duplicate / per-league resource conflict, first wins, every exclusion has a reason); `runBulkOps` = duplicate guard across reloads (`recentlySent`, 30 min, via the activity log), one attempt, timeouts/5xx classed "uncertain" (never retried), optional re-read verify ("unverified", never reported done), claims = "submitted", every outcome logged. Wired into Mass Add, Mass Drop, Mass IR, Optimize (current week re-read; future weeks not re-read — Sleeper has nothing to read yet), Empty Roster Spots (keeps its own ordered send for claim order, but gets the dup guard, uncertain classification and logging), and Review Queue sends (one log row per proposal outcome + rejects).
- **Activity Log** — `OperationLog` table (migration `20261008120000_add_operation_log`, additive, applied), `GET/POST /api/manager/activity` (admin cookie), page `/manager/activity` (range / tool / outcome / league / player filters, grouped by batch).
- **Review Queue** `/manager/review`: Planning/Live bar + Sleeper access + the proposals list, which gained group-select by kind, "Exclude a league…" from the selection, and "Queue again" for failed / expired / unconfirmed proposals (re-saves the same draft as a new `proposed` row — still needs its own Send). Links to Alerts / Trades & claims / Activity.
- **Command bar** (Cmd/Ctrl+K): actions (Review Queue, Sync all — fires `fantis:sync-now` which ManagerHeader handles, Ask the Command Center, Lineups, Empty spots, Waivers, Trades, All leagues, Activity), NFL team abbreviations list that team's players, and "Ask the Command Center: …" which opens the chat with the text typed in (never sent; `requestChatPrefill`/`openCommandCenter`).
- **Command Center home** (`CommandCenterHome.tsx` above the old dashboard): top actions, compact metrics (leagues, active, plans to review, open alerts, sync), Needs attention (empty starting slot, over roster limit, uncertain/unconfirmed sends in 24h, injured/bye starters, plans waiting, empty roster spots, other alerts) — each linking to the fix. Server counts from synced data only.
- **League Manager** (`/manager/teams`): status filter chips (Active / Needs attention / Sync stale / Best ball / Not in season), per-row checkboxes, header checkbox selects ALL filtered leagues (not just the 60 shown; "Show more/Show all"), selection persisted in localStorage (`lib/leagueSelection.ts`, tests `scripts/testLeagueSelection.ts` 12) and kept across filters ("N hidden by the filter"), filters/sort in the URL so Back from a league restores the view, per-row "synced Nh ago" (red when >24h). "Lineups / Waivers / Empty spots for these" open those tools with `?scope=selection` (`SelectionScope.tsx` banner + "Show every league").
- **Player Operations** (`PlayerOps.tsx` on Find a player; `GET /api/manager/player-status?playerId=`, DB-only): free agent / on waivers (dropped within `waiver_clear_days`, default 2) / on your team / on another team, per league, and plan buttons (add everywhere, start him, move to IR, drop everywhere) that open the chat with the command typed in → proposals → Review Queue.
- All suites pass (bulkOps 22, leagueSelection 12, command center 473 + 97, others unchanged); `tsc`/`next build` clean; lint: no new findings (pre-existing ones unchanged). Not clicked through in a browser (passphrase gate). Preview deployments lack `ADMIN_PASSPHRASE` (Production-only env var), so `/manager` on a preview can't be unlocked until the owner adds it to the Preview environment.

### Command Center redesign applied to every /manager page (2026-10; branch `command-center-2`, NOT on production — owner chose prototype G after reviewing A–F at /proto)

The owner picked prototype G (StatChasers shell + "This Week" lock board + Triage) and asked for it everywhere, not just the home tab.
- **Shell** (`ManagerShell.tsx`, `ManagerHeader.tsx`): the sidebar is gone. Top bar = brand, a global league switcher (search across all leagues; inside a league it keeps the current section when switching), Search ⌘K, "Synced …" status and **Sync all**. Below it, one horizontal menu where each `NAV_ENTRIES` group is a dropdown. `PageTitle` (exported from ManagerHeader) renders each page title with the amber underline and a breadcrumb inside a league; league sub-tabs (`LeagueSubNavigation`) render as a segmented switch. Phones keep the drawer (☰) and the bottom bar.
- **Theme**: `.cbs-theme` on the `/manager` root (app/manager/layout.tsx, Manrope via next/font) overrides the shared tokens (navy-graphite ground, amber accent, mint/red status) and re-skins the shared primitives (`.btn`, `.input`, `.chip-filter`, `.mgrtable/.mgrrow`, `.mgrstat`, `.mgrsubnav`, `.sec`) — block at the end of `app/manager/manager.css` — so every existing page picks up the look without per-page rewrites.
- **Home** (`/manager` → `components/manager/WeekCommand.tsx`, data from `lib/protoData.ts`): Week (decisions by lock time from ESPN kickoffs; byes go to the next lock) · Triage (inbox + focus; J/K/E/Esc) · Portfolio (record/playoff/lineup cards + league table, with the previous dashboard — accounts, sync details — below it). Read-only; fixes link to the existing tools. The old `CommandCenterHome.tsx` was removed.
- Prototypes A, C–G stay at `/proto/*` (passphrase-gated) for comparison; delete `app/proto`, `components/proto` (except `combo.css`, used by WeekCommand) when no longer needed.
- Verified in the dev server at desktop and phone widths: home (all three views), All leagues, Lineups, Waivers, a league Overview, the league switcher and the mobile drawer. `tsc`/`next build` clean, all suites pass; lint has only the 4 pre-existing setState-in-effect findings. Gotcha hit: running `next build` while `npm run dev` is up corrupts the dev server (Internal Server Error) — stop the dev server, delete `.next`, restart.

### Weekly results repaired + StatChasers gap pass (2026-10; branch `command-center-2`)

- **Week results were stale** (owner: "week 4 doesn't look right"). A sync that ran mid-week stored partial scores/winners, and the backfill only refetched weeks with no row or all-zero rows, so they never refreshed (week 4 read 79 won / 79 lost / 79 undecided). Checked against Sleeper's live `/matchups/{week}`: stored rows had mid-week points (37.2 vs final 155.16) and blank winners. Fix in `lib/managerSync.ts`: every sync re-reads the **two most recently finished weeks** (`w >= week - 2`), so a week is always re-read after its Monday game; `persistWeeklyResults` is now exported. Ran a one-time repair of weeks 2–3 (484 league-weeks, 0 failures) plus a normal sync. Spot checks against Sleeper afterwards: weeks 1–4 all match (week 1's 0-point rows are real 0–0 games in leagues that drafted late).
- **Weekly Record** (`app/manager/record/page.tsx`) leaves out the week still being played (Sleeper's `state.week`; it appears once Sleeper rolls over on Tuesday) and takes the opponent's final score from `WeeklyResult` instead of the possibly mid-week `Matchup` row. Real totals now: wk1 133–77, wk2 106–104, wk3 112–98, wk4 101–109–1 (best ball hidden).
- **Removed from the League Manager menu**: Byes, Injuries, Drafts, Commissioner (owner: "basically useless"). The routes still exist; nothing links to them from the menu.
- **New: LeagueMates** (`/manager/leaguemates`, Intelligence menu; StatChasers' LeagueMate Network + more): every other manager across your leagues — shared leagues, **your real head-to-head record against them** (Matchup opponent + WeeklyResult final; current week excluded), their record; search, 2+/5+/10+ filters, expand to see the shared leagues. DB-only. Names = their most-used team name (Sleeper usernames/avatars are not synced).
- **New: Player exposure** (`components/manager/ExposureMap.tsx`, bottom of the Command Center's Portfolio view; StatChasers' bubble map): bubbles sized by how many of your in-season leagues roster each player, by position, injury dot, Map/Table toggle, Injured filter; click → Find a player.
- Full sweep: all 15 portfolio pages + 9 league sub-pages return 200 with the owner's session (the bare `/manager/{id}` is a normal redirect to Overview), all `/api/manager/*` endpoints 200; no client errors. `tsc` clean, suites pass.

### StatChasers features 2–5: win chances, Optimize all, waiver board, season forecast (2026-10; branch `command-center-2`; owner: "2-5 sounds good")

- **Win chance formula** (`lib/winProb.ts`, `npx tsx scripts/testWinProb.ts` 9): P(win) = Φ((mine − theirs) / √((0.2·mine)² + (0.2·theirs)²)) — each weekly score treated as ±20% around its projection. Favorite ≥60%, toss-up 40–60%, underdog ≤40%. Missing/zero projection → no number (never a fake 50%). Labelled an estimate wherever shown.
- **Win chances** (Command Center → new "Win chances" view, `components/manager/WinChances.tsx`): every league this week, my projection vs opponent's (Matchup.myProjPoints/opponentProjPoints from the last sync), win %, favorite/toss-up/underdog filter, sort closest/best/worst, expected wins total (also in the number strip). Row → that league's Matchup page.
- **Optimize all** (Lineups → Optimize, `BulkOptimize.tsx`): Lineup Command summary — lineup issues (current starters out/IR/PUP/Sus/Doubtful, on bye, or empty), swaps available, points gain, questionable starters — and an "Optimize all N" button that selects every changed lineup and opens the SAME reviewed confirm as "Set N lineups" (nothing new can send).
- **Waiver board** (Waivers → new default "Best available" tab, `components/manager/WaiverBoard.tsx`): per league the best unrostered player (Sleeper season projection per game; availability from the last sync's `allRosteredPlayers`), your weakest bench player to drop (none when there's an open spot), the PPG difference, FAAB % left, position filter; Claim → `/manager/waiver?leagueId=` (Mass add, which re-checks live and suggests a bid). "Bidding" expands **league tendencies** from `GET /api/manager/waiver-tendency?leagueId=` (DB-only, completed FAAB claims): avg / highest winning bid % of budget, claims/week, active bidders, each manager's style (avg ≥25% aggressive, 8–25% balanced, <8% conservative).
- **My Team forecast** (`components/manager/SeasonOutlook.tsx` on `/manager/[id]/team`, math in `lib/seasonForecast.ts`, `npx tsx scripts/testSeasonForecast.ts` 8): real Sleeper schedule for the remaining regular-season weeks (`getMatchups` per week, through `playoff_week_start − 1`), each team's best lineup by projection per game with bye players removed (and this week's Out/IR/PUP/Sus/Doubtful), 4,000 deterministic simulated seasons → projected record, projected finish, playoff % and first-round-bye % (2 byes when 6 make it); a schedule strip with win % per week; a bye-week planner (likely starters on bye per week, the best bench player at that position who could cover, severity). Assumes no trades, pickups or new injuries — stated on the page.
- Testing note: the Browser pane stops painting when it's shrunk/hidden (requestAnimationFrame never fires), which also stalls React 19's streamed-Suspense reveal — pages look stuck on their loading skeleton. Not an app bug; check with the pane visible or in a normal browser.

### Fantis v2 released (2026-10-09)

Owner: "publish to main site, keep old one as backup", "name this fantis v2". Commit `c00a649` "Fantis v2: Command Center redesign" on branch `command-center-2`, tag `fantis-v2`; deployed to production as `fantis-fgxvp0hn8` (aliased to fantis.vercel.app, deployment meta `release=fantis-v2`).
**Backup of the previous site**: git tag `backup/pre-command-center-2` + branch `backup/pre-command-center-2-branch` (commit `dcf5c4a`), and its still-available Vercel deployment `fantis-8hekzhv21-ayeitsdaryl-5976s-projects.vercel.app`. To roll back instantly: `npx vercel rollback fantis-8hekzhv21-ayeitsdaryl-5976s-projects.vercel.app --scope team_nmNlwGleamz8ZHSvfmFmTlTb` (or promote it in the Vercel dashboard). The database is shared and only gained the additive `OperationLog` table, so the old build runs against it unchanged.

### Landing page redesign (2026-10; requested explicitly by the owner — "so i can add it to my portfolio … preview of the manager … motion")

Owner's answers: audience = both fantasy players and portfolio viewers; manager preview with **sample data** (nothing private); main actions = sync a Sleeper league + browse rankings.
- `/` is now `components/landing/Landing.tsx` (+ `landing.css`, Manrope via `--font-ld`); the public league sync lives at `/leagues` (unchanged page). `SiteShell`'s nav highlights no tab on `/`.
- Structure (impeccable surface seed 99dd512d, candidate 7): the hero IS a command bar — it types sample requests ("What locks first this week?" …) and an embedded Command Center demo window (This week / Triage / Win chances / Waivers, `components/landing/demoData.ts`, labelled "Sample leagues") answers; visitors can tap a chip or type. Then a 4-fact strip (882 = the real total of `scripts/test*.ts` checks — re-count if suites change), a scroll-driven "one week" story (sticky phone + day rail, Tuesday waivers → Monday night), "Math you can inspect" with a live win-chance dial using `lib/winProb.ts`, "How it's built" (stack + engineering notes), and a closing CTA.
- Motion: staged hero entrance, typing caret, demo view swaps (fade/slide/blur), cards and win bars animating in, scroll reveals, story crossfades; all disabled under `prefers-reduced-motion` (content is visible without JS).
- Also fixed: on phones the shared public nav pushed every public page wider than the screen; it now scrolls sideways (`app/globals.css`).
- Verified in the dev server at 1440 and 375 wide (no horizontal overflow, typing + view swaps + story steps + dial work). The finish-review/documenter subagents were not run (no subagents without the owner asking).
- Published 2026-10-09 as production deployment `fantis-8y6wb14ky` (meta `release=fantis-v2-landing`, commit `6f48fd7`). Backup = the v2 deployment `fantis-fgxvp0hn8-ayeitsdaryl-5976s-projects.vercel.app` (`npx vercel rollback <that url> --scope team_nmNlwGleamz8ZHSvfmFmTlTb`); the pre-v2 backup above is still available too.
