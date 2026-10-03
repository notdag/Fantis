import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LeagueTransactionsTab from "@/components/manager/LeagueTransactionsTab";
import { db } from "@/lib/db";
import type { ManagedLeague, ManagedTransaction, ManagedTransactionPlayer } from "@/lib/manager";

export const metadata: Metadata = {
  title: "Fantis — Transactions",
  robots: { index: false, follow: false },
};

const FEED_LIMIT = 150;

export default async function LeagueTransactionsPage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Transactions</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment.
        </p>
      </section>
    );
  }

  const row = await db.league.findUnique({ where: { id: leagueId }, include: { account: true } });
  if (!row) notFound();

  const league: ManagedLeague = {
    id: row.id,
    accountId: row.accountId,
    accountUsername: row.account.username,
    name: row.name,
    season: row.season,
    totalRosters: row.totalRosters,
    status: row.status,
    settings: row.settings,
    group: row.group,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  };

  const txnRows = await db.leagueTransaction.findMany({
    where: { leagueId },
    orderBy: { createdAt: "desc" },
    take: FEED_LIMIT,
  });

  const transactions: ManagedTransaction[] = txnRows.map((t) => ({
    id: t.id,
    leagueId: t.leagueId,
    leagueName: league.name,
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

  return <LeagueTransactionsTab league={league} transactions={transactions} />;
}
