import type { Metadata } from "next";
import AlertHistory from "@/components/manager/AlertHistory";
import { db } from "@/lib/db";
import type { ManagedHistoryAlert } from "@/lib/manager";

export const metadata: Metadata = {
  title: "Fantis — Alert history",
  robots: { index: false, follow: false },
};

export default async function HistoryPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Alert history</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const alertRows = await db.alert.findMany({
    orderBy: { createdAt: "desc" },
    take: 150,
    include: { league: true },
  });

  const alerts: ManagedHistoryAlert[] = alertRows.map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity as "action_required" | "review",
    message: a.message,
    playerId: a.playerId,
    week: a.week,
    createdAt: a.createdAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    snoozedUntil: a.snoozedUntil?.toISOString() ?? null,
    leagueName: a.league.name,
  }));

  return <AlertHistory alerts={alerts} />;
}
