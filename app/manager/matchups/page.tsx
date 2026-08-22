import type { Metadata } from "next";
import MatchupCenter from "@/components/manager/MatchupCenter";
import { db } from "@/lib/db";
import type { MatchupCenterRow } from "@/components/manager/MatchupCenter";

export const metadata: Metadata = {
  title: "Fantis — Matchups",
  robots: { index: false, follow: false },
};

export default async function MatchupsPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Matchups</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const [leagueRows, matchupRows] = await Promise.all([
    db.league.findMany({ select: { id: true, name: true } }),
    // Latest week's matchup per league, same reduce-in-JS pattern as
    // app/manager/teams/page.tsx — cheaper than 80 individual findFirst calls.
    db.matchup.findMany({ orderBy: { week: "desc" } }),
  ]);

  const latestByLeague = new Map<string, (typeof matchupRows)[number]>();
  for (const m of matchupRows) {
    if (!latestByLeague.has(m.leagueId)) latestByLeague.set(m.leagueId, m);
  }

  const rows: MatchupCenterRow[] = leagueRows
    .filter((lg) => latestByLeague.has(lg.id))
    .map((lg) => {
      const m = latestByLeague.get(lg.id)!;
      return {
        leagueId: lg.id,
        leagueName: lg.name,
        week: m.week,
        myPoints: m.myPoints,
        myProjPoints: m.myProjPoints,
        opponentTeamName: m.opponentTeamName,
        opponentPoints: m.opponentPoints,
        opponentProjPoints: m.opponentProjPoints,
      };
    });

  return <MatchupCenter rows={rows} />;
}
