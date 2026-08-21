import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LeagueOverview from "@/components/manager/LeagueOverview";
import { getLeagueDetailData } from "@/lib/managerLeagueData";

export const metadata: Metadata = {
  title: "Fantis — League Overview",
  robots: { index: false, follow: false },
};

export default async function LeagueOverviewPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Overview</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment.
        </p>
      </section>
    );
  }

  const data = await getLeagueDetailData(leagueId);
  if (!data) notFound();

  return (
    <LeagueOverview
      league={data.league}
      roster={data.roster}
      matchup={data.matchup}
      alerts={data.alerts}
      draft={data.draft}
      leagueRosters={data.leagueRosters}
    />
  );
}
