// Sleeper Manager's sync engine — the one place that calls Sleeper and
// writes League/SleeperAccount rows via Prisma. Shared by both the connect
// route (syncs the one newly-connected account) and the sync route (loops
// this over every connected account). Doesn't touch the SyncRun table
// itself — callers own that, since a single sync route call may span
// multiple accounts aggregated into one SyncRun row.
import { getLeagues, getLeagueRaw } from "./sleeper";
import { db } from "./db";
import type { Prisma } from "../generated/prisma/client";

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

export async function syncAccount(accountId: string, season: string): Promise<SyncResult> {
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
