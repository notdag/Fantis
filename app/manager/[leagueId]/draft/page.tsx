import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LeagueDraftTab from "@/components/manager/LeagueDraftTab";
import { getLeagueDetailData } from "@/lib/managerLeagueData";

export const metadata: Metadata = {
  title: "Fantis — Draft",
  robots: { index: false, follow: false },
};

export default async function LeagueDraftPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Draft</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment.
        </p>
      </section>
    );
  }

  const data = await getLeagueDetailData(leagueId);
  if (!data) notFound();

  return <LeagueDraftTab league={data.league} draft={data.draft} />;
}
