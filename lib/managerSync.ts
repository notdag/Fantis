// Sleeper Manager's sync engine — the one place that calls Sleeper and
// writes League/SleeperAccount rows via Prisma. Shared by both the connect
// route (syncs the one newly-connected account) and the sync route (loops
// this over every connected account). Doesn't touch the SyncRun table
// itself — callers own that, since a single sync route call may span
// multiple accounts aggregated into one SyncRun row.
//
// Phase 2 additions (roster/matchup/draft/alerts) happen inside the same
// per-league batched closure that already fetches settings, rather than a
// second pass — a second pass would either re-chunk for no benefit or lose
// the deliberate batch-of-10 concurrency control below.
import {
  getLeagues,
  getLeagueRaw,
  getRosters,
  getMatchups,
  getDraft,
  getLeagueUsers,
  getPlayers,
  getProjections,
  getTransactions,
} from "./sleeper";
import { computeAlerts } from "./managerAlerts";
import { db } from "./db";
import { Prisma } from "../generated/prisma/client";
import type { PlayerMap, ProjectionMap, SleeperMatchupRow, SleeperDraftRaw } from "./types";

// No documented Sleeper rate limit exists anywhere to tune against — this
// is a conservative, explicit, tunable constant, not a measured number.
const DETAIL_BATCH_SIZE = 10;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface SyncError {
  leagueId: string;
  leagueName?: string;
  message: string;
}

export interface SyncResult {
  leaguesSeen: number;
  leaguesOk: number;
  leaguesFailed: number;
  // Per-step counts within the leagues that succeeded overall — a league
  // can be "ok" while legitimately having no matchup (pre-draft) or no
  // draft (draft_id missing), so these are real sub-counts, not a second
  // pass/fail axis.
  rostersOk: number;
  matchupsOk: number;
  draftsOk: number;
  transactionsOk: number;
  errors: SyncError[];
  // Set only when the account-level league list itself couldn't be fetched
  // at all (nothing to batch yet) — distinct from a per-league failure.
  fatal?: string;
}

export async function syncAccount(
  accountId: string,
  season: string,
  week: number
): Promise<SyncResult> {
  let leagues: Awaited<ReturnType<typeof getLeagues>>;
  try {
    leagues = await getLeagues(accountId, season);
  } catch (e) {
    return {
      leaguesSeen: 0,
      leaguesOk: 0,
      leaguesFailed: 0,
      rostersOk: 0,
      matchupsOk: 0,
      draftsOk: 0,
      transactionsOk: 0,
      errors: [],
      fatal: e instanceof Error ? e.message : "Couldn't reach Sleeper for this account's leagues.",
    };
  }

  // Upsert every summary immediately — rows exist in the DB even before the
  // (slower, per-league) detail fetches below finish.
  for (const lg of leagues) {
    await db.league.upsert({
      where: { id: lg.league_id },
      create: {
        id: lg.league_id,
        accountId,
        name: lg.name,
        season: lg.season,
        totalRosters: lg.total_rosters,
        status: lg.status,
      },
      update: {
        name: lg.name,
        season: lg.season,
        totalRosters: lg.total_rosters,
        status: lg.status,
      },
    });
  }

  // Fetched once per sync call, not per league — getPlayers()'s localStorage
  // cache is silently skipped server-side, so a per-league call would mean
  // repeat multi-MB fetches. A failure here doesn't fail the run; it just
  // means the two alert checks that need real injury data are skipped.
  let pmap: PlayerMap | null = null;
  try {
    pmap = await getPlayers();
  } catch {
    pmap = null;
  }

  // Same reasoning as pmap above — fetched once per sync call, not per
  // league, since Sleeper's weekly projections apply to every league
  // equally (they're per-player, not per-league). A failure here doesn't
  // fail the run; matchups just sync with real scores and no projections
  // for this pass.
  let projMap: ProjectionMap | null = null;
  try {
    projMap = await getProjections(season, week);
  } catch {
    projMap = null;
  }

  const errors: SyncError[] = [];
  let ok = 0;
  let rostersOk = 0;
  let matchupsOk = 0;
  let draftsOk = 0;
  let transactionsOk = 0;

  // Chunks of 10 concurrent, sequential rounds. Promise.allSettled (not
  // Promise.all) deliberately — one bad league's fetch must not take down
  // the other 99 in the same sync.
  for (const batch of chunk(leagues, DETAIL_BATCH_SIZE)) {
    const results = await Promise.allSettled(
      batch.map(async (lg) => {
        const raw = await getLeagueRaw(lg.league_id);
        await db.league.update({
          where: { id: lg.league_id },
          data: {
            settings: raw as Prisma.InputJsonValue,
            lastSyncedAt: new Date(),
          },
        });

        const rosterPositions = (raw.roster_positions as string[] | undefined) ?? [];
        const draftId = raw.draft_id as string | undefined;
        const innerSettings = raw.settings as Record<string, unknown> | undefined;
        const tradeDeadlineWeek =
          typeof innerSettings?.trade_deadline === "number" ? innerSettings.trade_deadline : null;

        const rosters = await getRosters(lg.league_id);
        const myRoster = rosters.find((r) => r.owner_id === accountId) ?? null;

        // Every league member's real display/team name, fetched once per
        // league — one real Sleeper call, reused below for both the
        // LeagueRoster.teamName write and the opponent-name resolution
        // further down. Previously getLeagueUsers() only ran conditionally
        // (in-season leagues with a resolvable opponent this week), which
        // silently left every other team's name unresolved and skipped
        // pre_draft/drafting/complete leagues entirely.
        const users = await getLeagueUsers(lg.league_id).catch(() => []);
        const nameByOwnerId = new Map(
          users.map((u) => [u.user_id, u.metadata?.team_name || u.display_name || null])
        );

        // Every roster in the league, not just mine — getRosters() above
        // already returned all of them in this one call, so wins/losses/
        // ties/fpts/fptsAgainst below are zero additional Sleeper calls
        // (same real "already fetched, discarded" pattern that motivated
        // this table in the first place). Full per-league replace (delete
        // + createMany) since `rosters` is always the complete current
        // list, never a partial diff — same reasoning as RankedPlayer's
        // save.
        await db.$transaction([
          db.leagueRoster.deleteMany({ where: { leagueId: lg.league_id } }),
          db.leagueRoster.createMany({
            data: rosters.map((r) => {
              const settings = r.settings ?? {};
              return {
                leagueId: lg.league_id,
                rosterId: r.roster_id,
                ownerId: r.owner_id ?? null,
                players: r.players ?? [],
                starters: r.starters ?? [],
                wins: settings.wins ?? 0,
                losses: settings.losses ?? 0,
                ties: settings.ties ?? 0,
                fpts: settings.fpts != null ? settings.fpts + (settings.fpts_decimal ?? 0) / 100 : null,
                fptsAgainst:
                  settings.fpts_against != null
                    ? settings.fpts_against + (settings.fpts_against_decimal ?? 0) / 100
                    : null,
                teamName: r.owner_id ? nameByOwnerId.get(r.owner_id) ?? null : null,
              };
            }),
          }),
        ]);

        if (myRoster) {
          const settings = myRoster.settings ?? {};
          await db.roster.upsert({
            where: { leagueId: lg.league_id },
            create: {
              leagueId: lg.league_id,
              rosterId: myRoster.roster_id,
              starters: myRoster.starters ?? [],
              players: myRoster.players ?? [],
              reserve: myRoster.reserve ?? [],
              waiverPosition: settings.waiver_position ?? null,
              faabUsed: settings.waiver_budget_used ?? null,
              wins: settings.wins ?? 0,
              losses: settings.losses ?? 0,
              ties: settings.ties ?? 0,
              fpts: settings.fpts != null ? settings.fpts + (settings.fpts_decimal ?? 0) / 100 : null,
              fptsAgainst:
                settings.fpts_against != null
                  ? settings.fpts_against + (settings.fpts_against_decimal ?? 0) / 100
                  : null,
              lastSyncedAt: new Date(),
            },
            update: {
              rosterId: myRoster.roster_id,
              starters: myRoster.starters ?? [],
              players: myRoster.players ?? [],
              reserve: myRoster.reserve ?? [],
              waiverPosition: settings.waiver_position ?? null,
              faabUsed: settings.waiver_budget_used ?? null,
              wins: settings.wins ?? 0,
              losses: settings.losses ?? 0,
              ties: settings.ties ?? 0,
              fpts: settings.fpts != null ? settings.fpts + (settings.fpts_decimal ?? 0) / 100 : null,
              fptsAgainst:
                settings.fpts_against != null
                  ? settings.fpts_against + (settings.fpts_against_decimal ?? 0) / 100
                  : null,
              lastSyncedAt: new Date(),
            },
          });
          rostersOk += 1;
        }

        if (myRoster && lg.status === "in_season") {
          const rawMatchups = await getMatchups(lg.league_id, week).catch(() => null);
          if (rawMatchups) {
            const matchupRows = rawMatchups as unknown as SleeperMatchupRow[];
            const mine = matchupRows.find((r) => r.roster_id === myRoster.roster_id);
            if (mine && mine.matchup_id != null) {
              const opponentRow = matchupRows.find(
                (r) => r.matchup_id === mine.matchup_id && r.roster_id !== mine.roster_id
              );
              let opponentTeamName: string | null = null;
              if (opponentRow) {
                const opponentRoster = rosters.find((r) => r.roster_id === opponentRow.roster_id);
                if (opponentRoster?.owner_id) {
                  opponentTeamName = nameByOwnerId.get(opponentRoster.owner_id) ?? null;
                }
              }

              // Real Sleeper weekly projections (same endpoint/field used
              // for season-total trade value elsewhere), aligned by index
              // to each side's starters array — empty slots ("0"/missing)
              // project as 0, same convention the roster UI already uses
              // for empty-slot detection.
              const projFor = (id: string | undefined) =>
                !id || id === "0" ? 0 : (projMap?.[id]?.pts_ppr ?? 0);
              const myStartersProjPoints = (mine.starters ?? []).map(projFor);
              const myProjPoints = myStartersProjPoints.reduce((a, b) => a + b, 0);
              const opponentStartersProjPoints = (opponentRow?.starters ?? []).map(projFor);
              const opponentProjPoints = opponentRow
                ? opponentStartersProjPoints.reduce((a, b) => a + b, 0)
                : null;

              await db.matchup.upsert({
                where: { leagueId_week: { leagueId: lg.league_id, week } },
                create: {
                  leagueId: lg.league_id,
                  week,
                  myRosterId: mine.roster_id,
                  myMatchupId: mine.matchup_id,
                  myPoints: mine.points ?? 0,
                  myStarters: mine.starters ?? [],
                  myStartersPoints: mine.starters_points ?? [],
                  myProjPoints,
                  myStartersProjPoints,
                  opponentRosterId: opponentRow?.roster_id ?? null,
                  opponentTeamName,
                  opponentPoints: opponentRow?.points ?? null,
                  opponentStarters: opponentRow?.starters ?? [],
                  opponentStartersPoints: opponentRow?.starters_points ?? [],
                  opponentProjPoints,
                  opponentStartersProjPoints,
                  lastSyncedAt: new Date(),
                },
                update: {
                  myRosterId: mine.roster_id,
                  myMatchupId: mine.matchup_id,
                  myPoints: mine.points ?? 0,
                  myStarters: mine.starters ?? [],
                  myStartersPoints: mine.starters_points ?? [],
                  myProjPoints,
                  myStartersProjPoints,
                  opponentRosterId: opponentRow?.roster_id ?? null,
                  opponentTeamName,
                  opponentPoints: opponentRow?.points ?? null,
                  opponentStarters: opponentRow?.starters ?? [],
                  opponentStartersPoints: opponentRow?.starters_points ?? [],
                  opponentProjPoints,
                  opponentStartersProjPoints,
                  lastSyncedAt: new Date(),
                },
              });
              matchupsOk += 1;
            }
          }

          // Real trade/waiver/free-agent activity for this league's CURRENT
          // week only — one more real Sleeper call per in-season league
          // inside the same batch-of-10 concurrency this closure already
          // uses. Full replace scoped to {leagueId, week}: never touches
          // other weeks' already-synced rows, so history accumulates
          // naturally as each week gets synced once and never revisited
          // (see LeagueTransaction in prisma/schema.prisma).
          const rawTxns = await getTransactions(lg.league_id, week).catch(() => null);
          if (rawTxns) {
            const resolvePlayers = (m: Record<string, number> | null) =>
              m
                ? Object.entries(m).map(([playerId, rosterId]) => {
                    const r = rosters.find((rr) => rr.roster_id === rosterId);
                    return {
                      playerId,
                      playerName: pmap?.[playerId]?.n ?? playerId,
                      pos: pmap?.[playerId]?.p ?? null,
                      rosterId,
                      teamName: r?.owner_id ? nameByOwnerId.get(r.owner_id) ?? null : null,
                    };
                  })
                : null;

            const txnRows = rawTxns.map((t) => {
              const creatorRoster = t.creator ? rosters.find((r) => r.owner_id === t.creator) : undefined;
              return {
                leagueId: lg.league_id,
                week,
                sleeperTransactionId: t.transaction_id,
                type: t.type,
                status: t.status,
                createdAt: new Date(t.created),
                creatorTeamName: creatorRoster?.owner_id
                  ? nameByOwnerId.get(creatorRoster.owner_id) ?? null
                  : null,
                rosterIds: t.roster_ids ?? [],
                adds: (resolvePlayers(t.adds) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                drops: (resolvePlayers(t.drops) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                waiverBid: t.settings?.waiver_bid ?? null,
              };
            });

            await db.$transaction([
              db.leagueTransaction.deleteMany({ where: { leagueId: lg.league_id, week } }),
              ...(txnRows.length > 0 ? [db.leagueTransaction.createMany({ data: txnRows })] : []),
            ]);
            transactionsOk += 1;
          }
        }

        let draftStatus: string | null = null;
        if (draftId) {
          const rawDraft = await getDraft(draftId).catch(() => null);
          if (rawDraft) {
            const draft = rawDraft as unknown as SleeperDraftRaw;
            draftStatus = draft.status;
            await db.draft.upsert({
              where: { id: draftId },
              create: {
                id: draftId,
                leagueId: lg.league_id,
                status: draft.status,
                type: draft.type ?? null,
                startTime: draft.start_time ? new Date(draft.start_time) : null,
                lastSyncedAt: new Date(),
              },
              update: {
                status: draft.status,
                type: draft.type ?? null,
                startTime: draft.start_time ? new Date(draft.start_time) : null,
                lastSyncedAt: new Date(),
              },
            });
            draftsOk += 1;
          }
        }

        const computed = computeAlerts({
          leagueStatus: lg.status,
          currentWeek: week,
          rosterPositions,
          starters: myRoster?.starters ?? [],
          pmap,
          rosterOwnerIds: rosters.map((r) => r.owner_id),
          draftStatus,
          tradeDeadlineWeek,
        });
        // Diff against currently-unresolved alerts (by dedupKey) instead of
        // wiping and recreating — this is what makes snooze survive across
        // syncs (an update never touches snoozedUntil) and gives real
        // history (a dedupKey that drops out of `computed` gets a real
        // resolvedAt instead of just vanishing). Only matches against
        // resolvedAt: null rows, so a condition that reoccurs after having
        // once resolved creates a fresh row rather than reactivating the
        // old one — the old resolved instance stays intact as its own
        // history entry.
        const existingAlerts = await db.alert.findMany({
          where: { leagueId: lg.league_id, resolvedAt: null },
        });
        const existingByKey = new Map(existingAlerts.map((a) => [a.dedupKey, a]));
        const computedKeys = new Set(computed.map((a) => a.dedupKey));

        for (const a of computed) {
          const match = existingByKey.get(a.dedupKey);
          if (match) {
            await db.alert.update({
              where: { id: match.id },
              data: { message: a.message, severity: a.severity, week },
            });
          } else {
            await db.alert.create({
              data: {
                leagueId: lg.league_id,
                type: a.type,
                severity: a.severity,
                message: a.message,
                playerId: a.playerId,
                week,
                dedupKey: a.dedupKey,
              },
            });
          }
        }
        for (const old of existingAlerts) {
          if (!computedKeys.has(old.dedupKey)) {
            await db.alert.update({ where: { id: old.id }, data: { resolvedAt: new Date() } });
          }
        }
      })
    );
    results.forEach((r, i) => {
      const lg = batch[i];
      if (r.status === "fulfilled") {
        ok += 1;
      } else {
        errors.push({
          leagueId: lg.league_id,
          leagueName: lg.name,
          message: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    });
  }

  await db.sleeperAccount.update({
    where: { id: accountId },
    data: { lastSyncedAt: new Date() },
  });

  return {
    leaguesSeen: leagues.length,
    leaguesOk: ok,
    leaguesFailed: errors.length,
    rostersOk,
    matchupsOk,
    draftsOk,
    transactionsOk,
    errors,
  };
}
