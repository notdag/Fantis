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
import { scoringKey } from "@/lib/scoringKey";
import type { PlayerPrefs } from "@/lib/playerPrefs";
import type { LineupLeague } from "./LineupManager";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useCuratedRanks } from "./useCuratedRanks";

// Statuses that score nothing this week. Doubtful/Questionable stay
// eligible (they might play) and are just flagged next to the name.
const OUT_STATUSES = new Set(["Out", "IR", "PUP", "Sus", "COV", "NA", "DNR"]);

interface Row {
  key: string;
  leagueId: string;
  leagueName: string;
  rosterId: number;
  slotCodes: string[];
  scoring: "pts_ppr" | "pts_half_ppr" | "pts_std";
  result: OptimizeResult;
}


export default function BulkOptimize({
  leagues,
  pmap,
  token,
  currentWeek,
  season,
  prefs,
  prefsDirty,
  onEditPrefs,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  currentWeek: number;
  season: string;
  prefs: PlayerPrefs;
  prefsDirty: boolean;
  onEditPrefs: () => void;
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

  // "rankings": your /admin order decides who starts (projections only order
  // players you haven't ranked); "projections": pure best projection. The
  // My players priority/avoid lists apply in both.
  const [mode, setMode] = useState<"rankings" | "projections">("rankings");
  const ranks = useCuratedRanks();
  // Hides lineup changes whose net projection goes DOWN (a ranking or priority
  // is being followed at a projected cost). Off by default so nothing is
  // hidden without you choosing it.
  const [hideLosing, setHideLosing] = useState(false);
  const ranksPending = mode === "rankings" && !ranks;

  const priorityIndex = useMemo(() => new Map(prefs.priority.map((id, i) => [id, i])), [prefs.priority]);
  const avoidSet = useMemo(() => new Set(prefs.avoid), [prefs.avoid]);

  const { rows, lockedCount, unavailableCount } = useMemo(() => {
    const out: Row[] = [];
    let locked = 0;
    let unavailable = 0;
    if (!pmap || !proj || ranksPending) return { rows: out, lockedCount: 0, unavailableCount: 0 };

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
        priorityRank: (id) => priorityIndex.get(id),
        avoid: (id) => avoidSet.has(id),
        rankOrder: mode === "rankings" ? (id) => ranks?.get(id)?.order : undefined,
      });
      for (const id of candidates) {
        if (isLocked(id)) locked += 1;
        else if (isUnavailable(id)) unavailable += 1;
      }
      // A change can come from a preference even when it costs projected
      // points, so key on "is there a change", not on positive gain.
      if (result.changes.length > 0 && !(hideLosing && result.gain < -0.05)) {
        out.push({ key: l.league.id, leagueId: l.league.id, leagueName: l.league.name, rosterId: l.roster.rosterId, slotCodes, scoring: key, result });
      }
    }
    out.sort((a, b) => b.result.gain - a.result.gain);
    return { rows: out, lockedCount: locked, unavailableCount: unavailable };
  }, [leagues, pmap, proj, kickoffs, loadedAt, currentWeek, priorityIndex, avoidSet, mode, ranks, ranksPending, hideLosing]);

  const finished = (r: Row) => status[r.key]?.kind === "done";
  const selectedRows = rows.filter((r) => !deselected.has(r.key) && !finished(r));
  const totalGain = rows.reduce((s, r) => s + r.result.gain, 0);
  const name = (id: string | null) => (id ? pmap?.[id]?.n ?? id : "empty");
  const flag = (id: string | null) => {
    if (!id) return "";
    const inj = pmap?.[id]?.inj;
    const health = inj === "Questionable" ? " (Q)" : inj === "Doubtful" ? " (D)" : "";
    return `${priorityIndex.has(id) ? " ★" : avoidSet.has(id) ? " ⊘" : ""}${health}`;
  };
  // Show both sides of every swap with the numbers behind it (your ranking
  // and Sleeper's projection), so it's clear why each move is proposed.
  const rankLabel = (id: string) => {
    const rk = ranks?.get(id);
    return rk ? `#${rk.order + 1}` : "unranked";
  };
  const who = (r: Row, id: string | null) =>
    id ? `${name(id)}${flag(id)} (${rankLabel(id)} · ${(proj?.[id]?.[r.scoring] ?? 0).toFixed(1)})` : "empty";
  const reason = (c: { out: string | null; in: string | null }) => {
    if (c.in && priorityIndex.has(c.in)) return "your priority";
    if (c.out && avoidSet.has(c.out)) return "avoid list";
    const outInj = c.out ? pmap?.[c.out]?.inj : null;
    const outTeam = c.out ? pmap?.[c.out]?.t : null;
    if (c.out && ((outInj && OUT_STATUSES.has(outInj)) || (outTeam && BYE_WEEKS_2026[outTeam] === currentWeek))) {
      return "replacing an unavailable player";
    }
    if (mode === "rankings" && c.in) {
      const ri = ranks?.get(c.in)?.order;
      const ro = c.out ? ranks?.get(c.out)?.order : undefined;
      if (ri !== undefined && (ro === undefined || ri < ro)) return "ranked higher";
    }
    return "higher projection";
  };
  const swapText = (r: Row) =>
    r.result.changes.map((c) => `${c.slotCode}: ${who(r, c.out)} → ${who(r, c.in)} — ${reason(c)}`);

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
        <StatCard
          label="Net projected points"
          value={`${totalGain >= 0 ? "+" : ""}${totalGain.toFixed(1)}`}
          valueColor={totalGain > 0 ? "var(--mint)" : totalGain < 0 ? "var(--amber)" : undefined}
          sub={prefs.priority.length + prefs.avoid.length > 0 ? "after your player preferences" : undefined}
        />
        <StatCard label="Locked / out / bye" value={`${lockedCount} / ${unavailableCount}`} sub="started games · injured or on bye" />
      </StatCardGrid>
      <p className="hint" style={{ margin: "8px 0 12px" }}>
        {mode === "rankings"
          ? "Starts your highest-ranked healthy players (your /admin order); anyone you haven't ranked is ordered by Sleeper's projection and sits below ranked players."
          : "Starts the highest Sleeper projection at each slot, ignoring your /admin rankings."}{" "}
        Projections are Sleeper&rsquo;s week {currentWeek} numbers for each league&rsquo;s PPR / half /
        standard scoring (custom scoring like TE premium is approximated). Players whose game has
        started are locked in place; injured (Out/IR) and bye-week players are skipped. Each swap
        shows (your rank · projection) for both players. (Q) / (D) = Questionable / Doubtful.
      </p>
      <div className="field" style={{ margin: "0 0 12px", alignItems: "center" }}>
        <span className="portmeta">Choose by</span>
        <button className={`chip-filter ${mode === "rankings" ? "on" : ""}`} onClick={() => setMode("rankings")}>
          My rankings
        </button>
        <button className={`chip-filter ${mode === "projections" ? "on" : ""}`} onClick={() => setMode("projections")}>
          Projections only
        </button>
        <span style={{ flex: 1 }} />
        <button
          className={`chip-filter ${hideLosing ? "on" : ""}`}
          onClick={() => setHideLosing((v) => !v)}
          title="Hide lineup changes that would lower this week's projected points"
        >
          {hideLosing ? "Hiding lineups that lose projection" : "Hide lineups that lose projection"}
        </button>
      </div>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        {prefs.priority.length + prefs.avoid.length > 0 ? (
          <>
            Following your player preferences ({prefs.priority.length} priority, {prefs.avoid.length}{" "}
            avoid): ★ = priority, ⊘ = avoid.{" "}
            {prefsDirty && <span style={{ color: "var(--amber)" }}>Unsaved edits are included. </span>}
          </>
        ) : (
          <>No player preferences set — choosing purely by projection. </>
        )}
        <button className="linklike" style={{ fontSize: 13 }} onClick={onEditPrefs}>Edit My players</button>
      </p>

      {ranksPending ? (
        <p className="hint">Loading your rankings…</p>
      ) : rows.length === 0 ? (
        <p className="hint">Every lineup already matches your preferences and the best projections.</p>
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
                    <span style={{ color: r.result.gain < -0.05 ? "var(--amber)" : "var(--mint)" }}>
                      {r.result.gain >= 0 ? "+" : ""}{r.result.gain.toFixed(1)}
                    </span>
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
