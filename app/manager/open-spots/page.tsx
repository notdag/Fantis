import type { Metadata } from "next";
import OpenSpots from "@/components/manager/OpenSpots";
import { db } from "@/lib/db";
import { isBestBall, rosterPositionsFromSettings, slimLeagueSettings, type ManagedLeague } from "@/lib/manager";
import type { LineupLeague } from "@/components/manager/LineupManager";

export const metadata: Metadata = {
  title: "Fantis — Open Roster Spots",
  robots: { index: false, follow: false },
};

export default async function OpenSpotsPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Open Roster Spots</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const [leagueRows, rosterRows] = await Promise.all([
    db.league.findMany({
      where: { status: "in_season" },
      select: {
        id: true,
        accountId: true,
        name: true,
        season: true,
        totalRosters: true,
        status: true,
        settings: true,
        group: true,
        lastSyncedAt: true,
        account: { select: { username: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.roster.findMany(),
  ]);

  const rosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r]));

  // Same LineupLeague shape /manager/lineups builds, so this page can hand
  // its open-spot subset straight to the existing Mass Add board — no new
  // write path, just a pre-filtered view of the one that's already there.
  const leagues: LineupLeague[] = leagueRows
    .filter((lg) => !isBestBall(lg.settings) && rosterByLeague.has(lg.id))
    .map((lg) => {
      const r = rosterByLeague.get(lg.id)!;
      const league: ManagedLeague = {
        id: lg.id,
        accountId: lg.accountId,
        accountUsername: lg.account.username,
        name: lg.name,
        season: lg.season,
        totalRosters: lg.totalRosters,
        status: lg.status,
        settings: slimLeagueSettings(lg.settings),
        group: lg.group,
        lastSyncedAt: lg.lastSyncedAt?.toISOString() ?? null,
      };
      return {
        league,
        roster: {
          leagueId: r.leagueId,
          rosterId: r.rosterId,
          starters: r.starters,
          players: r.players,
          reserve: r.reserve,
          waiverPosition: r.waiverPosition,
          faabUsed: r.faabUsed,
          wins: r.wins,
          losses: r.losses,
          ties: r.ties,
          fpts: r.fpts,
          fptsAgainst: r.fptsAgainst,
          lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
        },
        rosterPositions: rosterPositionsFromSettings(lg.settings),
        alertCount: 0,
      };
    });

  return <OpenSpots leagues={leagues} />;
}
