import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LeagueOverview from "@/components/manager/LeagueOverview";
import { getLeagueDetailData } from "@/lib/managerLeagueData";
import { db } from "@/lib/db";
import type { ManagedTransaction, ManagedTransactionPlayer } from "@/lib/manager";

export const metadata: Metadata = {
  title: "Fantis — League Overview",
  robots: { index: false, follow: false },
};

const RECENT_TRANSACTIONS_LIMIT = 4;

function settingsField(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}

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

  const [data, txnRows] = await Promise.all([
    getLeagueDetailData(leagueId),
    db.leagueTransaction.findMany({
      where: { leagueId },
      orderBy: { createdAt: "desc" },
      take: RECENT_TRANSACTIONS_LIMIT,
    }),
  ]);
  if (!data) notFound();

  const recentTransactions: ManagedTransaction[] = txnRows.map((t) => ({
    id: t.id,
    leagueId: t.leagueId,
    leagueName: data.league.name,
    week: t.week,
    sleeperTransactionId: t.sleeperTransactionId,
    type: t.type,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    creatorTeamName: t.creatorTeamName,
    rosterIds: t.rosterIds,
    adds: t.adds as ManagedTransactionPlayer[] | null,
    drops: t.drops as ManagedTransactionPlayer[] | null,
    waiverBid: t.waiverBid,
  }));

  const rosterPositions = settingsField(data.league.settings, "roster_positions");
  const rosterPositionsArr = Array.isArray(rosterPositions) ? (rosterPositions as string[]) : [];

  return (
    <LeagueOverview
      league={data.league}
      roster={data.roster}
      matchup={data.matchup}
      alerts={data.alerts}
      draft={data.draft}
      leagueRosters={data.leagueRosters}
      recentTransactions={recentTransactions}
      rosterPositions={rosterPositionsArr}
    />
  );
}
