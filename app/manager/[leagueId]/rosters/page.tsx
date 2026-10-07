import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LeagueRosters from "@/components/manager/LeagueRosters";
import { getLeagueDetailData } from "@/lib/managerLeagueData";

export const metadata: Metadata = {
  title: "Fantis — Rosters",
  robots: { index: false, follow: false },
};

export default async function LeagueRostersPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Rosters</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment.
        </p>
      </section>
    );
  }

  const data = await getLeagueDetailData(leagueId);
  if (!data) notFound();

  return (
    <LeagueRosters
      league={data.league}
      leagueRosters={data.leagueRosters}
      myRosterId={data.roster?.rosterId ?? null}
    />
  );
}
