import type { Metadata } from "next";
import { db } from "@/lib/db";
import { alertSeverityChipStyle, formatRelative } from "@/lib/manager";

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

  const alerts = await db.alert.findMany({
    orderBy: { createdAt: "desc" },
    take: 150,
    include: { league: true },
  });

  const dayKey = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const groups = new Map<string, typeof alerts>();
  for (const a of alerts) {
    const key = dayKey(a.createdAt);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Alert history</h1>
          <p>
            The most recent 150 alerts across every synced league — active, resolved, and
            snoozed. Resolved means a later sync no longer found the condition true; nothing here
            is ever silently deleted.
          </p>
        </div>
      </section>

      {alerts.length === 0 ? (
        <section className="sec">
          <p className="hint">No alerts recorded yet — run a sync to start building history.</p>
        </section>
      ) : (
        Array.from(groups.entries()).map(([day, rows]) => (
          <section className="sec" key={day}>
            <div className="sechead">
              <h2 style={{ fontSize: 18 }}>{day}</h2>
              <span className="rt">{rows.length} alerts</span>
            </div>
            <div className="mgrtable">
              {rows.map((a) => {
                const now = new Date();
                const status = a.resolvedAt
                  ? { label: `resolved ${formatRelative(a.resolvedAt.toISOString())}`, severity: "clear" as const }
                  : a.snoozedUntil && a.snoozedUntil > now
                    ? { label: `snoozed until ${a.snoozedUntil.toLocaleDateString()}`, severity: null }
                    : { label: a.severity === "action_required" ? "active" : "review", severity: a.severity as "action_required" | "review" };
                return (
                  <div className="mgrrow static" key={a.id}>
                    <span className="portmeta" style={{ minWidth: 60 }}>
                      {a.createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                    <span className="tname" style={{ flex: 1 }}>{a.league.name}</span>
                    <span className="portmeta" style={{ flex: 2 }}>{a.message}</span>
                    {status.severity ? (
                      <span className="pos" style={alertSeverityChipStyle(status.severity)}>{status.label}</span>
                    ) : (
                      <span className="portmeta" style={{ color: "var(--dim)" }}>{status.label}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </>
  );
}
