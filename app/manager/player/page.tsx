import type { Metadata } from "next";
import PlayerLeagues from "@/components/manager/PlayerLeagues";
import { db } from "@/lib/db";
import type { PlayerLeagueRow, PlayerAlertRef } from "@/components/manager/PlayerLeagues";

export const metadata: Metadata = {
  title: "Fantis — Player search",
  robots: { index: false, follow: false },
};

export default async function PlayerPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Player search</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const [leagueRows, rosterRows, alertRows] = await Promise.all([
    db.league.findMany({ orderBy: { name: "asc" } }),
    db.roster.findMany(),
    db.alert.findMany({
      where: { playerId: { not: null }, resolvedAt: null },
      select: { leagueId: true, playerId: true, snoozedUntil: true },
    }),
  ]);

  const rosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r]));

  const leagues: PlayerLeagueRow[] = leagueRows
    .filter((lg) => rosterByLeague.has(lg.id))
    .map((lg) => {
      const roster = rosterByLeague.get(lg.id)!;
      return {
        leagueId: lg.id,
        leagueName: lg.name,
        players: roster.players,
        starters: roster.starters,
      };
    });

  // Same "snoozed drops out of the needs-attention view" filtering as
  // the Commissioner page and Today's dashboard groups.
  const now = new Date();
  const alertRefs: PlayerAlertRef[] = alertRows
    .filter((a) => !a.snoozedUntil || a.snoozedUntil <= now)
    .map((a) => ({
      leagueId: a.leagueId,
      playerId: a.playerId as string,
    }));

  return <PlayerLeagues leagues={leagues} alertRefs={alertRefs} />;
}
