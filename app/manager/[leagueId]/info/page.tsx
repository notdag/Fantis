import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LeagueInfoTab from "@/components/manager/LeagueInfoTab";
import { getLeagueDetailData } from "@/lib/managerLeagueData";

export const metadata: Metadata = {
  title: "Fantis — League Info",
  robots: { index: false, follow: false },
};

export default async function LeagueInfoPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>League Info</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment.
        </p>
      </section>
    );
  }

  const data = await getLeagueDetailData(leagueId);
  if (!data) notFound();

  return <LeagueInfoTab league={data.league} />;
}
