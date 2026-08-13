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
} from "./sleeper";
import { computeAlerts } from "./managerAlerts";
import { db } from "./db";
import type { Prisma } from "../generated/prisma/client";
import type { PlayerMap, SleeperMatchupRow, SleeperDraftRaw } from "./types";

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

  const errors: SyncError[] = [];
  let ok = 0;

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

        if (myRoster) {
          const settings = myRoster.settings ?? {};
          await db.roster.upsert({
            where: { leagueId: lg.league_id },
            create: {
              leagueId: lg.league_id,
              rosterId: myRoster.roster_id,
              starters: myRoster.starters ?? [],
              players: myRoster.players ?? [],
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
                  const users = await getLeagueUsers(lg.league_id).catch(() => []);
                  const opponentUser = users.find((u) => u.user_id === opponentRoster.owner_id);
                  opponentTeamName =
                    opponentUser?.metadata?.team_name || opponentUser?.display_name || null;
                }
              }
              await db.matchup.upsert({
                where: { leagueId_week: { leagueId: lg.league_id, week } },
                create: {
                  leagueId: lg.league_id,
                  week,
                  myRosterId: mine.roster_id,
                  myMatchupId: mine.matchup_id,
                  myPoints: mine.points ?? 0,
                  opponentRosterId: opponentRow?.roster_id ?? null,
                  opponentTeamName,
                  opponentPoints: opponentRow?.points ?? null,
                  lastSyncedAt: new Date(),
                },
                update: {
                  myRosterId: mine.roster_id,
                  myMatchupId: mine.matchup_id,
                  myPoints: mine.points ?? 0,
                  opponentRosterId: opponentRow?.roster_id ?? null,
                  opponentTeamName,
                  opponentPoints: opponentRow?.points ?? null,
                  lastSyncedAt: new Date(),
                },
              });
            }
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
        await db.alert.deleteMany({ where: { leagueId: lg.league_id } });
        if (computed.length > 0) {
          await db.alert.createMany({
            data: computed.map((a) => ({
              leagueId: lg.league_id,
              type: a.type,
              severity: a.severity,
              message: a.message,
              playerId: a.playerId,
              week,
            })),
          });
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
    errors,
  };
}
