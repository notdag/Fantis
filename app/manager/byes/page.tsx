import type { Metadata } from "next";
import ByePlanner from "@/components/manager/ByePlanner";
import { db } from "@/lib/db";
import type { ByeLeagueRow } from "@/components/manager/ByePlanner";

export const metadata: Metadata = {
  title: "Fantis — Bye Week Planner",
  robots: { index: false, follow: false },
};

export default async function ByesPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Bye Week Planner</h2>
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

  const leagues: ByeLeagueRow[] = leagueRows
    .filter((lg) => rosterByLeague.has(lg.id))
    .map((lg) => ({
      leagueId: lg.id,
      leagueName: lg.name,
      players: rosterByLeague.get(lg.id)!.players,
    }));

  return <ByePlanner leagues={leagues} />;
}
