import type { Metadata } from "next";
import ActionQueue from "@/components/manager/ActionQueue";
import { db } from "@/lib/db";
import type { ActionItem, ActionQueueRoster } from "@/components/manager/ActionQueue";

export const metadata: Metadata = {
  title: "Fantis — Action Queue",
  robots: { index: false, follow: false },
};

export default async function ActionsPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Action Queue</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const [alertRows, rosterRows] = await Promise.all([
    db.alert.findMany({
      where: { resolvedAt: null },
      include: { league: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.roster.findMany({ select: { leagueId: true, players: true, starters: true } }),
  ]);

  const items: ActionItem[] = alertRows.map((a) => ({
    id: a.id,
    leagueId: a.leagueId,
    leagueName: a.league.name,
    type: a.type,
    severity: a.severity as "action_required" | "review",
    message: a.message,
    playerId: a.playerId,
    week: a.week,
    createdAt: a.createdAt.toISOString(),
    resolvedAt: null,
    snoozedUntil: a.snoozedUntil?.toISOString() ?? null,
  }));

  const rosters: ActionQueueRoster[] = rosterRows.map((r) => ({
    leagueId: r.leagueId,
    players: r.players,
    starters: r.starters,
  }));

  return <ActionQueue items={items} rosters={rosters} />;
}
