import type { Metadata } from "next";
import OpenSpots from "@/components/manager/OpenSpots";
import { db } from "@/lib/db";
import { isBestBall, rosterPositionsFromSettings } from "@/lib/manager";
import type { OpenSpotLeague } from "@/components/manager/OpenSpots";

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
    db.league.findMany({ where: { status: "in_season" }, orderBy: { name: "asc" } }),
    db.roster.findMany(),
  ]);

  const rosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r]));

  const leagues: OpenSpotLeague[] = leagueRows
    .filter((lg) => !isBestBall(lg.settings) && rosterByLeague.has(lg.id))
    .map((lg) => {
      const roster = rosterByLeague.get(lg.id)!;
      const limit = rosterPositionsFromSettings(lg.settings).length;
      const active = roster.players.length - roster.reserve.length;
      return { leagueId: lg.id, leagueName: lg.name, active, limit };
    })
    .filter((l) => l.limit > 0);

  return <OpenSpots leagues={leagues} />;
}
