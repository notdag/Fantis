import type { Metadata } from "next";
import InboxManager, { type InboxLeague, type CompletedTrade } from "@/components/manager/InboxManager";
import { db } from "@/lib/db";
import { slimLeagueSettings } from "@/lib/manager";
import type { ManagedTransactionPlayer } from "@/lib/manager";

export const metadata: Metadata = {
  title: "Fantis — Trades & Claims",
  robots: { index: false, follow: false },
};

export default async function InboxPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Trades &amp; Claims</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  // Only already-synced data here (no Sleeper calls, no token): the leagues,
  // which roster is mine in each, and every team's name so a trade can say who
  // it's from. Pending offers/claims themselves are fetched in the browser.
  const [leagueRows, rosterRows, teamRows, tradeRows] = await Promise.all([
    db.league.findMany({ select: { id: true, name: true, status: true, settings: true }, orderBy: { name: "asc" } }),
    db.roster.findMany({ select: { leagueId: true, rosterId: true } }),
    db.leagueRoster.findMany({ select: { leagueId: true, rosterId: true, teamName: true } }),
    // Real completed-trade history — "Completed" tab, below. Already synced
    // by the regular sync (same LeagueTransaction table /manager/transactions
    // reads from); no new Sleeper call, scoped to trade rows only so this
    // page stays the one real "all my trades" view (pending + resolved)
    // instead of duplicating that page's full add/drop/trade firehose.
    db.leagueTransaction.findMany({
      where: { type: "trade" },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { league: { select: { name: true } } },
    }),
  ]);

  const myRoster = new Map(rosterRows.map((r) => [r.leagueId, r.rosterId]));
  const teams: Record<string, Record<number, string | null>> = {};
  for (const t of teamRows) (teams[t.leagueId] ??= {})[t.rosterId] = t.teamName;

  const leagues: InboxLeague[] = leagueRows
    .filter((l) => myRoster.has(l.id))
    .map((l) => ({
      id: l.id,
      name: l.name,
      status: l.status,
      settings: slimLeagueSettings(l.settings),
      rosterId: myRoster.get(l.id)!,
      teams: teams[l.id] ?? {},
    }));

  // Real completed trades I was actually part of — rosterIds is the trade's
  // real participant list, so this is a true "my trades" filter, not every
  // trade across leagues I happen to share with other owners.
  const completedTrades: CompletedTrade[] = tradeRows
    .filter((t) => {
      const myId = myRoster.get(t.leagueId);
      return myId != null && t.rosterIds.includes(myId);
    })
    .map((t) => ({
      id: t.id,
      leagueId: t.leagueId,
      leagueName: t.league.name,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      adds: t.adds as ManagedTransactionPlayer[] | null,
      drops: t.drops as ManagedTransactionPlayer[] | null,
    }));

  return <InboxManager leagues={leagues} completedTrades={completedTrades} />;
}
