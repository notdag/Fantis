import type { Metadata } from "next";
import TransactionFeed from "@/components/manager/TransactionFeed";
import { db } from "@/lib/db";
import { getState, currentProjectionWeek } from "@/lib/sleeper";
import type { ManagedTransaction, ManagedTransactionPlayer } from "@/lib/manager";

export const metadata: Metadata = {
  title: "Fantis — Transactions",
  robots: { index: false, follow: false },
};

const FEED_LIMIT = 300;

export default async function TransactionsPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Transactions</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const state = await getState().catch(() => null);
  const currentWeek = state ? currentProjectionWeek(state) : null;

  const [recentRows, thisWeekRows, inSeasonLeagueCount] = await Promise.all([
    db.leagueTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: FEED_LIMIT,
      include: { league: { select: { name: true } } },
    }),
    // Unbounded (only filtered by week, never FEED_LIMIT) so the hero row's
    // counts are a true complete total across every league, never silently
    // clipped by the feed list's cap below.
    currentWeek != null
      ? db.leagueTransaction.findMany({
          where: { week: currentWeek },
          include: { league: { select: { name: true } } },
        })
      : Promise.resolve([]),
    db.league.count({ where: { status: "in_season" } }),
  ]);

  const map = (rows: typeof recentRows): ManagedTransaction[] =>
    rows.map((t) => ({
      id: t.id,
      leagueId: t.leagueId,
      leagueName: t.league.name,
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

  return (
    <TransactionFeed
      recent={map(recentRows)}
      thisWeek={map(thisWeekRows)}
      currentWeek={currentWeek}
      inSeasonLeagueCount={inSeasonLeagueCount}
    />
  );
}
