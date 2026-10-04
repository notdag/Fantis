"use client";

import { useEffect, useState } from "react";
import type { LiveRosterState } from "@/lib/useLiveRosters";

function ago(ms: number | null, now: number): string {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)}h ago`;
}

// Says, in plain words, how fresh the data behind the Lineups tools is — and lets you refresh it. Rosters are read
// live from Sleeper (not from the stored sync); injury designations come from Sleeper's player list, refreshed on
// demand. Nothing here ever sends a change to Sleeper.
export default function LiveStatusBar({
  live,
  leagueNames,
  injuriesAt,
  refreshing,
  onRefreshInjuries,
}: {
  live: LiveRosterState;
  leagueNames: Record<string, string>;
  injuriesAt: number | null;
  refreshing: boolean;
  onRefreshInjuries: () => Promise<{ ok: boolean; message: string }>;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const failedCount = live.failed.length;
  const okCount = Object.keys(live.live).length;

  const refreshInjuries = async () => {
    setMsg(null);
    const r = await onRefreshInjuries();
    setMsg({ ok: r.ok, text: r.message });
    setTimeout(() => setMsg(null), 9000);
  };

  return (
    <div
      className="card sync"
      style={{ maxWidth: "none", marginBottom: 12, padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13 }}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: live.loading ? "var(--amber)" : failedCount > 0 ? "var(--amber)" : "var(--mint)",
          }}
        />
        {live.loading ? (
          <>Reading rosters live from Sleeper… {live.done}/{live.total}</>
        ) : (
          <>
            <b>Rosters live from Sleeper</b> · {okCount}/{live.total} leagues · {ago(live.loadedAt, now)}
          </>
        )}
      </span>
      <button className="btn ghost sm" onClick={live.reload} disabled={live.loading}>
        {live.loading ? "Reloading…" : "Reload rosters"}
      </button>

      <span style={{ fontSize: 13, color: "var(--muted)" }}>
        Injury data: {injuriesAt ? ago(injuriesAt, now) : "loading…"}
      </span>
      <button className="btn ghost sm" onClick={refreshInjuries} disabled={refreshing}>
        {refreshing ? "Refreshing…" : "Refresh injuries"}
      </button>
      {msg && (
        <span className="hint" style={{ margin: 0, color: msg.ok ? "var(--mint)" : "var(--red)" }}>
          {msg.text}
        </span>
      )}

      {!live.loading && failedCount > 0 && (
        <span className="hint" style={{ margin: 0, flexBasis: "100%", color: "var(--amber)" }}>
          ⚠ Couldn&rsquo;t read {failedCount} league{failedCount === 1 ? "" : "s"} live (showing the last stored sync for{" "}
          {failedCount === 1 ? "it" : "them"}; sending is still checked against live data):{" "}
          {live.failed
            .slice(0, 4)
            .map((f) => leagueNames[f.leagueId] ?? f.leagueId)
            .join(", ")}
          {failedCount > 4 ? ` and ${failedCount - 4} more` : ""}.{" "}
          <button type="button" className="link" onClick={live.reload}>
            Retry
          </button>
        </span>
      )}
    </div>
  );
}
