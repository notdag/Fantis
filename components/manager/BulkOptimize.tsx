"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getProjections } from "@/lib/sleeper";
import { getWeekKickoffs } from "@/lib/espnGames";
import { BYE_WEEKS_2026 } from "@/lib/byeWeeks";
import { buildStartingSlots } from "@/lib/rosterSlots";
import { optimizeLineup, type OptimizeResult } from "@/lib/lineupOptimizer";
import { runBulk, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { setStarters } from "@/lib/sleeperWrite";
import type { PlayerMap, ProjectionMap } from "@/lib/types";
import type { LineupLeague } from "./LineupManager";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";

// Statuses that score nothing this week. Doubtful/Questionable stay
// eligible (they might play) and are just flagged next to the name.
const OUT_STATUSES = new Set(["Out", "IR", "PUP", "Sus", "COV", "NA", "DNR"]);

interface Row {
  key: string;
  leagueId: string;
  leagueName: string;
  rosterId: number;
  slotCodes: string[];
  result: OptimizeResult;
}

function scoringKey(settings: unknown): "pts_ppr" | "pts_half_ppr" | "pts_std" {
  const ss = settings && typeof settings === "object" ? (settings as Record<string, unknown>).scoring_settings : null;
  const rec = ss && typeof ss === "object" ? (ss as Record<string, unknown>).rec : undefined;
  if (rec === 0) return "pts_std";
  if (rec === 0.5) return "pts_half_ppr";
  return "pts_ppr";
}

export default function BulkOptimize({
  leagues,
  pmap,
  token,
  currentWeek,
  season,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  currentWeek: number;
  season: string;
}) {
  const [proj, setProj] = useState<ProjectionMap | null>(null);
  const [kickoffs, setKickoffs] = useState<Record<string, string> | null>(null);
  const [loadError, setLoadError] = useState("");
  // Captured when the data loads (not read during render) so "locked" is
  // stable between renders; Reload refreshes it.
  const [loadedAt, setLoadedAt] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProjections(season, currentWeek), getWeekKickoffs(season, currentWeek).catch(() => ({}))])
      .then(([p, k]) => {
        if (cancelled) return;
        setProj(p);
        setKickoffs(k);
        setLoadedAt(Date.now());
        setLoadError("");
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load projections.");
      });
    return () => {
      cancelled = true;
    };
  }, [season, currentWeek, reloadTick]);

  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const abortRef = useRef({ aborted: false });

  const { rows, lockedCount, unavailableCount } = useMemo(() => {
    const out: Row[] = [];
    let locked = 0;
    let unavailable = 0;
    if (!pmap || !proj) return { rows: out, lockedCount: 0, unavailableCount: 0 };

    const isUnavailable = (id: string) => {
      const e = pmap[id];
      if (!e) return true;
      if (e.inj && OUT_STATUSES.has(e.inj)) return true;
      return !!e.t && BYE_WEEKS_2026[e.t] === currentWeek;
    };
    const isLocked = (id: string) => {
      const team = pmap[id]?.t;
      const ko = team && kickoffs ? kickoffs[team] : undefined;
      return !!ko && Date.parse(ko) <= loadedAt;
    };

    for (const l of leagues) {
      if (!l.roster) continue;
      const key = scoringKey(l.league.settings);
      const slotCodes = buildStartingSlots(l.rosterPositions).map((s) => s.code);
      if (slotCodes.length === 0) continue;
      const candidates = l.roster.players.filter((id) => !l.roster!.reserve.includes(id));
      const result = optimizeLineup({
        slotCodes,
        starters: l.roster.starters,
        candidates,
        posOf: (id) => pmap[id]?.p ?? null,
        points: (id) => proj[id]?.[key] ?? 0,
        unavailable: isUnavailable,
        locked: isLocked,
      });
      for (const id of candidates) {
        if (isLocked(id)) locked += 1;
        else if (isUnavailable(id)) unavailable += 1;
      }
      if (result.gain > 0.05 && result.changes.length > 0) {
        out.push({ key: l.league.id, leagueId: l.league.id, leagueName: l.league.name, rosterId: l.roster.rosterId, slotCodes, result });
      }
    }
    out.sort((a, b) => b.result.gain - a.result.gain);
    return { rows: out, lockedCount: locked, unavailableCount: unavailable };
  }, [leagues, pmap, proj, kickoffs, loadedAt, currentWeek]);

  const finished = (r: Row) => status[r.key]?.kind === "done";
  const selectedRows = rows.filter((r) => !deselected.has(r.key) && !finished(r));
  const totalGain = rows.reduce((s, r) => s + r.result.gain, 0);
  const name = (id: string | null) => (id ? pmap?.[id]?.n ?? id : "empty");
  const flag = (id: string | null) => {
    const inj = id ? pmap?.[id]?.inj : null;
    return inj === "Questionable" ? " (Q)" : inj === "Doubtful" ? " (D)" : "";
  };
  const swapText = (r: Row) =>
    r.result.changes.map((c) => `${c.slotCode}: ${name(c.out)} → ${name(c.in)}${flag(c.in)}`);

  const toggle = (key: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const start = async () => {
    if (!token) return;
    setConfirming(false);
    setRunning(true);
    setSummary("");
    abortRef.current = { aborted: false };
    const tasks: BulkTask[] = selectedRows.map((r) => ({
      key: r.key,
      run: async () => {
        await setStarters(token, {
          leagueId: r.leagueId,
          rosterId: r.rosterId,
          starters: r.result.starters,
          week: currentWeek,
        });
        return `${r.result.changes.length} swap${r.result.changes.length === 1 ? "" : "s"}`;
      },
    }));
    const result = await runBulk(tasks, {
      signal: abortRef.current,
      onStatus: (key, s) => setStatus((prev) => ({ ...prev, [key]: s })),
    });
    setRunning(false);
    setSummary(
      `${result.done} lineups set${result.failed ? `, ${result.failed} failed` : ""}${
        result.skipped ? `, ${result.skipped} skipped` : ""
      }.${result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : ""}` +
        (result.done ? " Run Sync now on the Command Center to refresh Fantis's own data before another pass." : "")
    );
  };

  if (!pmap) return <p className="hint">Loading players…</p>;
  if (loadError) {
    return (
      <p className="hint" style={{ color: "var(--red)" }}>
        {loadError}{" "}
        <button className="linklike" onClick={() => setReloadTick((t) => t + 1)}>Retry</button>
      </p>
    );
  }
  if (!proj) return <p className="hint">Loading this week&rsquo;s projections…</p>;

  return (
    <>
      <StatCardGrid variant="grid">
        <StatCard label="Lineups to improve" value={rows.length} />
        <StatCard label="Projected points gained" value={totalGain.toFixed(1)} valueColor={totalGain > 0 ? "var(--mint)" : undefined} />
        <StatCard label="Locked / out / bye" value={`${lockedCount} / ${unavailableCount}`} sub="started games · injured or on bye" />
      </StatCardGrid>
      <p className="hint" style={{ margin: "8px 0 12px" }}>
        Best legal lineup per league from Sleeper&rsquo;s week {currentWeek} projections, using each
        league&rsquo;s own slots and PPR / half / standard scoring. Leagues with custom scoring
        (TE premium, 6-point passing TDs) are approximated. Players whose game has started are
        locked in place; injured (Out/IR) and bye-week players are skipped. (Q) / (D) marks a
        Questionable or Doubtful player being started.
      </p>

      {rows.length === 0 ? (
        <p className="hint">Every lineup is already optimal for the data available.</p>
      ) : (
        <>
          <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
            <button className="chip-filter" onClick={() => setDeselected(new Set())}>Select all</button>
            <button className="chip-filter" onClick={() => setDeselected(new Set(rows.map((r) => r.key)))}>Select none</button>
            <button className="chip-filter" onClick={() => setReloadTick((t) => t + 1)}>Reload</button>
            <span style={{ flex: 1 }} />
            {running ? (
              <button className="btn ghost" onClick={() => (abortRef.current.aborted = true)}>Abort</button>
            ) : (
              <button className="btn" disabled={!token || selectedRows.length === 0 || confirming} onClick={() => setConfirming(true)}>
                Set {selectedRows.length} lineups
              </button>
            )}
          </div>
          {!token && <p className="hint" style={{ color: "var(--red)" }}>Connect write access above first.</p>}

          {confirming && (
            <BulkConfirm
              title={`Set ${selectedRows.length} lineups (+${selectedRows.reduce((s, r) => s + r.result.gain, 0).toFixed(1)} projected points)`}
              lines={selectedRows.map((r) => (
                <span key={r.key}>
                  {r.leagueName}: {swapText(r).join("; ")}
                </span>
              ))}
              confirmLabel={`Send ${selectedRows.length} lineups to Sleeper`}
              onConfirm={start}
              onCancel={() => setConfirming(false)}
            />
          )}
          {summary && <p className="hint" style={{ color: "var(--bone)" }}>{summary}</p>}

          <div style={{ maxHeight: 640, overflowY: "auto" }}>
            <DataTable>
              <TableHeaderRow>
                <span style={{ width: 22 }} />
                <span style={{ flex: 1 }}>League · swaps</span>
                <span style={{ minWidth: 130 }}>Projected</span>
                <span style={{ minWidth: 90 }}>Result</span>
              </TableHeaderRow>
              {rows.map((r) => (
                <TableRow key={r.key} style={finished(r) ? { opacity: 0.6 } : undefined}>
                  <input
                    type="checkbox"
                    checked={!deselected.has(r.key) && !finished(r)}
                    disabled={finished(r) || running}
                    onChange={() => toggle(r.key)}
                  />
                  <span className="tname" style={{ flex: 1 }}>
                    {r.leagueName}
                    {swapText(r).map((t, i) => (
                      <span key={i} className="portmeta" style={{ display: "block", fontWeight: 400 }}>{t}</span>
                    ))}
                  </span>
                  <span className="portmeta" style={{ minWidth: 130 }}>
                    {r.result.currentPoints.toFixed(1)} → {r.result.optimalPoints.toFixed(1)}{" "}
                    <span style={{ color: "var(--mint)" }}>+{r.result.gain.toFixed(1)}</span>
                  </span>
                  <StatusCell status={status[r.key]} />
                </TableRow>
              ))}
            </DataTable>
          </div>
        </>
      )}
    </>
  );
}
