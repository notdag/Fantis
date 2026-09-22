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
