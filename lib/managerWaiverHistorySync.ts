// Real historical waiver usage (FAAB spent, waiver position) for past
// seasons — deliberately separate from lib/managerSync.ts's main
// syncAccount(), which only ever handles the current season. A past
// season is its own real Sleeper league_id (getLeagues(accountId, season)
// returns a distinct list per season), so this loops a capped number of
// past seasons and re-uses the same getLeagues()/getRosters() calls the
// current-season sync already relies on — no new Sleeper endpoints.
//
// Runs as its own on-demand action (a button on the Waivers page), not
// folded into the main "Refresh" button — the main sync already runs
// ~100 leagues at a 60s route budget; multiplying that by N extra seasons
// on every single Refresh click would reintroduce the exact latency
// problem this session already fixed once for the main sync path.
import { getLeagues, getRosters } from "./sleeper";
import { db } from "./db";

// No documented limit on how many past seasons Sleeper keeps — capped here
// to a real, bounded number of seasons rather than looping until Sleeper
// returns empty (which could run indefinitely for a very old account).
const MAX_PAST_SEASONS = 5;

export interface WaiverHistorySyncResult {
  seasonsSeen: number;
  leaguesSeen: number;
  leaguesOk: number;
  leaguesFailed: number;
}

export async function syncWaiverHistory(accountId: string, currentSeason: string): Promise<WaiverHistorySyncResult> {
  const currentYear = parseInt(currentSeason, 10);
  const seasons = Array.from({ length: MAX_PAST_SEASONS }, (_, i) => String(currentYear - 1 - i));

  let leaguesSeen = 0;
  let leaguesOk = 0;
  let leaguesFailed = 0;
  let seasonsSeen = 0;

  for (const season of seasons) {
    const leagues = await getLeagues(accountId, season).catch(() => null);
    if (!leagues || leagues.length === 0) continue;
    seasonsSeen += 1;

    const results = await Promise.allSettled(
      leagues.map(async (lg) => {
        const rosters = await getRosters(lg.league_id);
        const myRoster = rosters.find((r) => r.owner_id === accountId);
        if (!myRoster) return;
        const settings = myRoster.settings ?? {};
        await db.waiverHistory.upsert({
          where: { accountId_leagueId_season: { accountId, leagueId: lg.league_id, season } },
          create: {
            accountId,
            leagueId: lg.league_id,
            leagueName: lg.name,
            season,
            rosterId: myRoster.roster_id,
            waiverPosition: settings.waiver_position ?? null,
            faabUsed: settings.waiver_budget_used ?? null,
            faabBudget: null,
          },
          update: {
            leagueName: lg.name,
            rosterId: myRoster.roster_id,
            waiverPosition: settings.waiver_position ?? null,
            faabUsed: settings.waiver_budget_used ?? null,
            syncedAt: new Date(),
          },
        });
      })
    );

    leaguesSeen += leagues.length;
    for (const r of results) {
      if (r.status === "fulfilled") leaguesOk += 1;
      else leaguesFailed += 1;
    }
  }

  return { seasonsSeen, leaguesSeen, leaguesOk, leaguesFailed };
}
