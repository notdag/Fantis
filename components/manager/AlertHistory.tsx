"use client";

import { useMemo, useState } from "react";
import { alertSeverityChipStyle, formatRelative, type ManagedHistoryAlert } from "@/lib/manager";
import { IconCalendar, IconCheck, IconFlag } from "./MgrIcons";

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
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Alert history</h1>
          <p>
            The most recent 150 alerts across every synced league — active, resolved, and
            snoozed. Resolved means a later sync no longer found the condition true; nothing here
            is ever silently deleted.
          </p>
        </div>
        {alerts.length > 0 && (
          <div className="mgrherorow">
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{
                  color: summary.active > 0 ? "var(--red)" : "var(--mint)",
                  background: `color-mix(in srgb, ${summary.active > 0 ? "var(--red)" : "var(--mint)"} 16%, transparent)`,
                }}
              >
                <IconFlag width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Active</p>
                <p className="mgrstatvalue" style={{ color: summary.active > 0 ? "var(--red)" : undefined }}>
                  {summary.active}
                </p>
              </div>
            </div>
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{ color: "var(--mint)", background: "color-mix(in srgb, var(--mint) 16%, transparent)" }}
              >
                <IconCheck width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Resolved</p>
                <p className="mgrstatvalue" style={{ color: "var(--mint)" }}>{summary.resolved}</p>
              </div>
            </div>
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{ color: "var(--muted)", background: "color-mix(in srgb, var(--muted) 16%, transparent)" }}
              >
                <IconCalendar width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Snoozed</p>
                <p className="mgrstatvalue">{summary.snoozed}</p>
              </div>
            </div>
          </div>
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
                  <div className="sechead">
                    <h2 style={{ fontSize: 18 }}>{day}</h2>
                    <span className="rt">{rows.length} alerts</span>
                  </div>
                  <div className="mgrtable">
                    {rows.map((a) => {
                      const status = statusDisplay(a, now);
                      return (
                        <div className="mgrrow static" key={a.id}>
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
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </>
      )}
    </>
  );
}
