import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LeagueTeam from "@/components/manager/LeagueTeam";
import { getLeagueDetailData } from "@/lib/managerLeagueData";

export const metadata: Metadata = {
  title: "Fantis — My Team",
  robots: { index: false, follow: false },
};

function settingsField(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}

export default async function LeagueTeamPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>My Team</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment.
        </p>
      </section>
    );
  }

  const data = await getLeagueDetailData(leagueId);
  if (!data) notFound();

  const rosterPositions = settingsField(data.league.settings, "roster_positions");
  const rosterPositionsArr = Array.isArray(rosterPositions) ? (rosterPositions as string[]) : [];

  return <LeagueTeam league={data.league} roster={data.roster} rosterPositions={rosterPositionsArr} />;
}
