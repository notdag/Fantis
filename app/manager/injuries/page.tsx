import type { Metadata } from "next";
import InjuryReport from "@/components/manager/InjuryReport";
import { db } from "@/lib/db";
import type { InjuryLeagueRow } from "@/components/manager/InjuryReport";

export const metadata: Metadata = {
  title: "Fantis — Injury Report",
  robots: { index: false, follow: false },
};

export default async function InjuriesPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Injury Report</h2>
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

  const leagues: InjuryLeagueRow[] = leagueRows
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

  return <InjuryReport leagues={leagues} />;
}
