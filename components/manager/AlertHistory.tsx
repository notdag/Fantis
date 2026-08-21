"use client";

import { useMemo, useState } from "react";
import { alertSeverityChipStyle, formatRelative, type ManagedHistoryAlert } from "@/lib/manager";
import { IconCalendar, IconCheck, IconFlag } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";

type Classification = "active" | "resolved" | "snoozed";

function classify(a: ManagedHistoryAlert, now: Date): Classification {
  if (a.resolvedAt) return "resolved";
  if (a.snoozedUntil && new Date(a.snoozedUntil) > now) return "snoozed";
  return "active";
}

function statusDisplay(a: ManagedHistoryAlert, now: Date) {
  const c = classify(a, now);
  if (c === "resolved") {
    return { label: `resolved ${formatRelative(a.resolvedAt)}`, severity: "clear" as const };
  }
  if (c === "snoozed") {
    return { label: `snoozed until ${new Date(a.snoozedUntil!).toLocaleDateString()}`, severity: null };
  }
  return {
    label: a.severity === "action_required" ? "active" : "review",
    severity: a.severity,
  };
}

const FILTERS: { key: "all" | Classification; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "resolved", label: "Resolved" },
  { key: "snoozed", label: "Snoozed" },
];

export default function AlertHistory({ alerts }: { alerts: ManagedHistoryAlert[] }) {
  const [filter, setFilter] = useState<"all" | Classification>("all");

  const summary = useMemo(() => {
    const now = new Date();
    let active = 0, resolved = 0, snoozed = 0;
    for (const a of alerts) {
      const c = classify(a, now);
      if (c === "active") active += 1;
      else if (c === "resolved") resolved += 1;
      else snoozed += 1;
    }
    return { active, resolved, snoozed };
  }, [alerts]);

  const filtered = useMemo(() => {
    if (filter === "all") return alerts;
    const now = new Date();
    return alerts.filter((a) => classify(a, now) === filter);
  }, [alerts, filter]);

  const dayKey = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const groups = useMemo(() => {
    const map = new Map<string, ManagedHistoryAlert[]>();
    for (const a of filtered) {
      const key = dayKey(a.createdAt);
      (map.get(key) ?? map.set(key, []).get(key)!).push(a);
    }
    return map;
  }, [filtered]);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          title="Alert history"
          description={
            <>
              The most recent 150 alerts across every synced league — active, resolved, and
              snoozed. Resolved means a later sync no longer found the condition true; nothing
              here is ever silently deleted.
            </>
          }
        />
        {alerts.length > 0 && (
          <StatCardGrid variant="hero">
            <StatCard
              icon={IconFlag}
              color={summary.active > 0 ? "var(--red)" : "var(--mint)"}
              label="Active"
              value={summary.active}
              valueColor={summary.active > 0 ? "var(--red)" : undefined}
            />
            <StatCard icon={IconCheck} color="var(--mint)" label="Resolved" value={summary.resolved} valueColor="var(--mint)" />
            <StatCard icon={IconCalendar} color="var(--muted)" label="Snoozed" value={summary.snoozed} />
          </StatCardGrid>
        )}
      </section>

      {alerts.length === 0 ? (
        <section className="sec">
          <p className="hint">No alerts recorded yet — run a sync to start building history.</p>
        </section>
      ) : (
        <>
          <section className="sec" style={{ paddingBottom: 0 }}>
            <div className="field" style={{ marginBottom: 0, gap: 8 }}>
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`chip-filter ${filter === f.key ? "on" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}{" "}
                  <span className="portmeta">
                    {f.key === "all" ? alerts.length : summary[f.key as Classification]}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {filtered.length === 0 ? (
            <section className="sec">
              <p className="hint">No alerts match this filter.</p>
            </section>
          ) : (
            Array.from(groups.entries()).map(([day, rows]) => {
              const now = new Date();
              return (
                <section className="sec" key={day}>
                  <SectionHead title={day} right={`${rows.length} alerts`} />
                  <DataTable>
                    {rows.map((a) => {
                      const status = statusDisplay(a, now);
                      return (
                        <TableRow key={a.id}>
                          <span className="portmeta" style={{ minWidth: 60 }}>
                            {new Date(a.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </span>
                          <span className="tname" style={{ flex: 1 }}>{a.leagueName}</span>
                          <span className="portmeta" style={{ flex: 2 }}>{a.message}</span>
                          {status.severity ? (
                            <span className="pos" style={alertSeverityChipStyle(status.severity)}>{status.label}</span>
                          ) : (
                            <span className="portmeta" style={{ color: "var(--dim)" }}>{status.label}</span>
                          )}
                        </TableRow>
                      );
                    })}
                  </DataTable>
                </section>
              );
            })
          )}
        </>
      )}
    </>
  );
}
