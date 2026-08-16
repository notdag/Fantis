import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MatchupDetail from "@/components/manager/MatchupDetail";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "Fantis — Matchup",
  robots: { index: false, follow: false },
};

// Sleeper's league `settings` blob is untyped JSON — read defensively,
// same pattern as LeagueDetail.tsx.
function settingsField(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}

export default async function MatchupPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;

  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Matchup</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment.
        </p>
      </section>
    );
  }

  const league = await db.league.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const matchup = await db.matchup.findFirst({ where: { leagueId }, orderBy: { week: "desc" } });
  if (!matchup) {
    return (
      <section className="sec">
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>{league.name}</h1>
          <p>No matchup synced yet for this league.</p>
        </div>
      </section>
    );
  }

  const rosterPositions = settingsField(league.settings, "roster_positions");
  const rosterPositionsArr = Array.isArray(rosterPositions) ? (rosterPositions as string[]) : [];

  return (
    <MatchupDetail
      leagueId={league.id}
      leagueName={league.name}
      week={matchup.week}
      myPoints={matchup.myPoints}
      myStarters={matchup.myStarters}
      myStartersPoints={matchup.myStartersPoints}
      opponentTeamName={matchup.opponentTeamName}
      opponentPoints={matchup.opponentPoints}
      opponentStarters={matchup.opponentStarters}
      opponentStartersPoints={matchup.opponentStartersPoints}
      rosterPositions={rosterPositionsArr}
    />
  );
}
