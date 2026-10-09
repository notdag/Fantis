"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";

// Command Center 2.0 — Activity Log. Every change the manager tools sent (or skipped / couldn't confirm) is written to the
// OperationLog table by lib/bulkOps.ts; this page reads it back with filters. Read-only: nothing here talks to Sleeper.

export interface ActivityEntry {
  id: string;
  at: string;
  kind: string;
  tool: string;
  status: string;
  leagueId: string | null;
  leagueName: string | null;
  playerId: string | null;
  playerName: string | null;
  action: string;
  message: string | null;
  batchId: string | null;
}

const TOOL_LABEL: Record<string, string> = {
  mass_add: "Mass Add",
  mass_drop: "Mass Drop",
  mass_ir: "Mass IR",
  optimize: "Optimize",
  fill_spots: "Empty Roster Spots",
  review_queue: "Review Queue",
};
const STATUS_LABEL: Record<string, string> = {
  ok: "Done",
  submitted: "Claim placed",
  failed: "Failed",
  skipped: "Skipped",
  uncertain: "Outcome unknown",
  unverified: "Not confirmed",
  started: "Started",
};
const STATUS_COLOR: Record<string, string> = {
  ok: "var(--mint)",
  submitted: "var(--mint)",
  failed: "var(--red)",
  uncertain: "var(--amber)",
  unverified: "var(--amber)",
  skipped: "var(--muted)",
  started: "var(--muted)",
};
const RANGES: [string, string, number | null][] = [
  ["24h", "Last 24h", 24],
  ["7d", "Last 7 days", 24 * 7],
  ["30d", "Last 30 days", 24 * 30],
  ["all", "All", null],
];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function ActivityLog({ leagues }: { leagues: { id: string; name: string }[] }) {
  const [range, setRange] = useState("7d");
  const [tool, setTool] = useState("");
  const [status, setStatus] = useState("");
  const [leagueId, setLeagueId] = useState("");
  const [player, setPlayer] = useState("");
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const q = new URLSearchParams({ limit: "1000" });
    const hrs = RANGES.find((r) => r[0] === range)?.[2];
    if (hrs) q.set("from", new Date(Date.now() - hrs * 3600_000).toISOString());
    if (tool) q.set("tool", tool);
    if (status) q.set("status", status);
    if (leagueId) q.set("leagueId", leagueId);
    if (player.trim().length >= 2) q.set("player", player.trim());
    try {
      const res = await fetch(`/api/manager/activity?${q}`);
      if (!res.ok) throw new Error(res.status === 401 ? "Your admin session expired — reload and sign in again." : `HTTP ${res.status}`);
      const b = (await res.json()) as { entries: ActivityEntry[] };
      setEntries(b.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the activity log.");
    } finally {
      setLoading(false);
    }
  }, [range, tool, status, leagueId, player]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250); // debounce the player box
    return () => clearTimeout(t);
  }, [load]);

  const counts = useMemo(() => {
    const c = { ok: 0, failed: 0, attention: 0, skipped: 0 };
    for (const e of entries ?? []) {
      if (e.status === "ok" || e.status === "submitted") c.ok++;
      else if (e.status === "failed") c.failed++;
      else if (e.status === "uncertain" || e.status === "unverified") c.attention++;
      else if (e.status === "skipped") c.skipped++;
    }
    return c;
  }, [entries]);

  // Group rows that were sent together (same batch) under one header so a 200-league run reads as one action.
  const groups = useMemo(() => {
    const out: { key: string; tool: string; at: string; rows: ActivityEntry[] }[] = [];
    for (const e of entries ?? []) {
      const key = e.batchId ?? e.id;
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(e);
      else out.push({ key, tool: e.tool, at: e.at, rows: [e] });
    }
    return out;
  }, [entries]);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          description={
            <>
              Everything the manager tools sent to Sleeper, skipped, or couldn&rsquo;t confirm — newest first. &ldquo;Outcome unknown&rdquo;
              means the request timed out and may still have gone through; &ldquo;Not confirmed&rdquo; means a re-read after sending
              didn&rsquo;t show the change. Check those in Sleeper.
            </>
          }
        />
        <StatCardGrid variant="grid">
          <StatCard label="Done / claims placed" value={counts.ok} valueColor="var(--mint)" />
          <StatCard label="Need a look" value={counts.attention} valueColor={counts.attention ? "var(--amber)" : undefined} sub="unknown or not confirmed" />
          <StatCard label="Failed" value={counts.failed} valueColor={counts.failed ? "var(--red)" : undefined} />
          <StatCard label="Skipped" value={counts.skipped} sub="duplicates, changed rosters" />
        </StatCardGrid>
      </section>

      <section className="sec">
        <div className="field" style={{ flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}>
          {RANGES.map(([k, label]) => (
            <button key={k} type="button" className={`chip-filter${range === k ? " on" : ""}`} onClick={() => setRange(k)}>
              {label}
            </button>
          ))}
          <select className="input" style={{ maxWidth: 170 }} value={tool} onChange={(e) => setTool(e.target.value)} aria-label="Tool">
            <option value="">All tools</option>
            {Object.entries(TOOL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select className="input" style={{ maxWidth: 170 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All outcomes</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select className="input" style={{ maxWidth: 220 }} value={leagueId} onChange={(e) => setLeagueId(e.target.value)} aria-label="League">
            <option value="">All leagues</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <input className="input" style={{ maxWidth: 200 }} placeholder="Player…" value={player} onChange={(e) => setPlayer(e.target.value)} aria-label="Player" />
          <button type="button" className="ccexample" disabled={loading} onClick={() => void load()}>
            {loading ? "Loading…" : "Reload"}
          </button>
        </div>

        {error && <p className="hint" style={{ color: "var(--red)" }}>{error}</p>}
        {entries && entries.length === 0 && !error && (
          <p className="hint">Nothing logged for these filters yet. Changes sent from Mass Add, Mass Drop, Mass IR, Optimize, Empty Roster Spots and the Review Queue show up here.</p>
        )}
        {entries === null && !error && <p className="hint">Loading…</p>}

        {groups.map((g) => {
          const ok = g.rows.filter((r) => r.status === "ok" || r.status === "submitted").length;
          return (
            <div key={g.key} style={{ marginBottom: 14 }}>
              <SectionHead
                level={3}
                style={{ marginBottom: 6 }}
                title={`${TOOL_LABEL[g.tool] ?? g.tool} · ${fmt(g.at)}`}
                right={g.rows.length > 1 ? `${ok} of ${g.rows.length} went through` : undefined}
              />
              <DataTable>
                <TableHeaderRow>
                  <span style={{ minWidth: 110 }}>Outcome</span>
                  <span style={{ flex: 1 }}>Change</span>
                  <span style={{ minWidth: 180 }}>League</span>
                </TableHeaderRow>
                {g.rows.map((e) => (
                  <TableRow key={e.id}>
                    <span className="portmeta" style={{ minWidth: 110, color: STATUS_COLOR[e.status], fontWeight: 600 }}>
                      {STATUS_LABEL[e.status] ?? e.status}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="tname" style={{ display: "block" }}>{e.action}</span>
                      {e.message && <span className="portmeta" style={{ display: "block", fontWeight: 400 }}>{e.message}</span>}
                    </span>
                    <span className="portmeta" style={{ minWidth: 180 }}>
                      {e.leagueId ? <Link href={`/manager/${e.leagueId}`}>{e.leagueName ?? e.leagueId}</Link> : "—"}
                    </span>
                  </TableRow>
                ))}
              </DataTable>
            </div>
          );
        })}
      </section>
    </>
  );
}
