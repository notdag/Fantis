"use client";

import { useMemo, useRef, useState } from "react";
import { runBulk, bulkResultTone, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { preflightRosters } from "@/lib/liveRosters";
import { addDropFreeAgent } from "@/lib/sleeperWrite";
import { posChipStyle } from "@/lib/players";
import type { PlayerMap } from "@/lib/types";
import type { PlayerPrefs } from "@/lib/playerPrefs";
import type { LineupLeague } from "./LineupManager";
import { PlayerAvatar } from "./Avatar";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useRefreshLeagues } from "./useRefreshLeagues";

const MAX_TARGETS = 8;

interface DropRow {
  key: string;
  leagueId: string;
  leagueName: string;
  rosterId: number;
  playerId: string;
  where: "starting" | "bench" | "IR";
  priority: boolean;
}

// Release one or more players from every league you pick, in one batch. Nothing is sent until you confirm, every league is
// re-read from Sleeper right before sending (a league that changed is set aside), and starters / Priority-list players are
// listed but left unticked so they're only ever released on purpose.
export default function BulkDrop({
  leagues,
  pmap,
  token,
  prefs,
  onSent,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  prefs: PlayerPrefs;
  onSent?: () => void;
}) {
  const [targets, setTargets] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryColor, setSummaryColor] = useState<string | undefined>(undefined);
  const abortRef = useRef({ aborted: false });
  const refresh = useRefreshLeagues();
  const priority = useMemo(() => new Set(prefs.priority), [prefs.priority]);

  // How many of your leagues roster each player — the search only offers players you actually have.
  const exposure = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leagues) for (const id of l.roster?.players ?? []) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [leagues]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !pmap) return [];
    return [...exposure.keys()]
      .filter((id) => !targets.includes(id) && (pmap[id]?.n ?? "").toLowerCase().includes(q))
      .sort((a, b) => (exposure.get(b) ?? 0) - (exposure.get(a) ?? 0))
      .slice(0, 8);
  }, [query, pmap, exposure, targets]);

  const rows = useMemo(() => {
    const out: DropRow[] = [];
    for (const l of leagues) {
      const r = l.roster;
      if (!r) continue;
      for (const id of targets) {
        if (!r.players.includes(id)) continue;
        out.push({
          key: `${l.league.id}:${id}`,
          leagueId: l.league.id,
          leagueName: l.league.name,
          rosterId: r.rosterId,
          playerId: id,
          where: r.reserve.includes(id) ? "IR" : r.starters.includes(id) ? "starting" : "bench",
          priority: priority.has(id),
        });
      }
    }
    return out.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
  }, [leagues, targets, priority]);

  // Default: bench and IR rows are ticked; starters and Priority-list players need a deliberate tick.
  const isPicked = (r: DropRow) => (r.key in picked ? picked[r.key] : r.where !== "starting" && !r.priority);
  const finished = (r: DropRow) => status[r.key]?.kind === "done";
  const selected = rows.filter((r) => isPicked(r) && !finished(r));
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.leagueName.toLowerCase().includes(q) || (pmap?.[r.playerId]?.n ?? "").toLowerCase().includes(q)) : rows;
  }, [rows, filter, pmap]);
  const setVisible = (on: boolean) => setPicked((p) => ({ ...p, ...Object.fromEntries(visible.map((r) => [r.key, on])) }));
  const nameOf = (id: string) => pmap?.[id]?.n ?? id;

  const start = async () => {
    if (!token) return;
    setConfirming(false);
    setRunning(true);
    setSummary("Checking every roster against Sleeper first…");
    setSummaryColor(undefined);
    abortRef.current = { aborted: false };
    const batch = [...selected];
    const pre = await preflightRosters(
      batch.map((r) => {
        const l = leagues.find((x) => x.league.id === r.leagueId);
        return {
          leagueId: r.leagueId,
          rosterId: r.rosterId,
          base: l?.roster ? { starters: l.roster.starters, players: l.roster.players, reserve: l.roster.reserve } : null,
          strictStarters: false,
        };
      })
    );
    setSummary("");
    const tasks: BulkTask[] = batch.map((r) => ({
      key: r.key,
      run: async () => {
        const p = pre[r.leagueId];
        if (p?.blocked) throw new Error(p.blocked);
        if (p?.fresh && !p.fresh.players.includes(r.playerId)) throw new Error(`${nameOf(r.playerId)} is no longer on this roster — nothing sent.`);
        await addDropFreeAgent(token, { leagueId: r.leagueId, rosterId: r.rosterId, dropPlayerId: r.playerId });
        return "released";
      },
    }));
    const doneKeys: string[] = [];
    const result = await runBulk(tasks, {
      signal: abortRef.current,
      onStatus: (key, s) => {
        if (s.kind === "done") doneKeys.push(key);
        setStatus((prev) => ({ ...prev, [key]: s }));
      },
    });
    setRunning(false);
    if (result.done > 0) onSent?.();
    const refreshed = result.done > 0 ? await refresh(doneKeys.map((k) => k.split(":")[0])) : null;
    const tone = bulkResultTone(result);
    setSummaryColor(tone.color);
    setSummary(
      `${tone.prefix}${result.done} released${result.failed ? `, ${result.failed} failed` : ""}${result.skipped ? `, ${result.skipped} skipped` : ""}.` +
        (result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : "") +
        (refreshed === null ? "" : refreshed ? " Fantis's data was refreshed for those leagues." : " Couldn't auto-refresh Fantis's data — press Refresh (top right).")
    );
  };

  const starters = selected.filter((r) => r.where === "starting").length;
  const prot = selected.filter((r) => r.priority).length;

  return (
    <section className="sec">
      <p className="hint" style={{ marginTop: 0 }}>
        Release players from as many leagues as you like in one go. Pick up to {MAX_TARGETS} players, untick any league you want to keep him in, then
        confirm. Bench and IR rows start ticked; starters and your Priority-list players start unticked so they&rsquo;re only released on purpose. A player
        whose game has already kicked off usually can&rsquo;t be dropped until it ends — Sleeper will refuse that league and the rest still go through.
      </p>
      <div className="field" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <input
          className="input"
          style={{ maxWidth: 300 }}
          placeholder="Search a player you roster…"
          value={query}
          disabled={running || targets.length >= MAX_TARGETS}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search a player to release"
        />
        {targets.map((id) => (
          <button key={id} type="button" className="chip-filter on" disabled={running} onClick={() => setTargets((t) => t.filter((x) => x !== id))}>
            {nameOf(id)} ✕
          </button>
        ))}
      </div>
      {matches.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 10px" }}>
          {matches.map((id) => (
            <button
              key={id}
              type="button"
              className="chip-filter"
              onClick={() => {
                setTargets((t) => [...t, id]);
                setQuery("");
              }}
            >
              + {nameOf(id)} {pmap?.[id]?.p ? `· ${pmap[id].p}` : ""} · on {exposure.get(id)} league{exposure.get(id) === 1 ? "" : "s"}
            </button>
          ))}
        </div>
      )}

      {targets.length > 0 && rows.length === 0 && <p className="hint">None of your leagues roster {targets.length === 1 ? "him" : "them"}.</p>}

      {rows.length > 0 && (
        <>
          <div className="field" style={{ alignItems: "center", flexWrap: "wrap", gap: 8, margin: "10px 0" }}>
            <input className="input" style={{ maxWidth: 240 }} placeholder="Filter leagues…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="chip-filter" disabled={running} onClick={() => setVisible(true)}>
              {filter ? "Select shown" : "Select all"}
            </button>
            <button className="chip-filter" disabled={running} onClick={() => setVisible(false)}>
              {filter ? "Select none shown" : "Select none"}
            </button>
            <span style={{ flex: 1 }} />
            {running ? (
              <button className="btn ghost" onClick={() => (abortRef.current.aborted = true)}>
                Abort
              </button>
            ) : (
              <button className="btn" disabled={!token || selected.length === 0} onClick={() => setConfirming(true)}>
                Release from {selected.length} league{selected.length === 1 ? "" : "s"}
              </button>
            )}
          </div>
          {!token && <p className="hint" style={{ color: "var(--red)" }}>Connect write access above first.</p>}
          {confirming && (
            <BulkConfirm
              title={`Release ${selected.length} player${selected.length === 1 ? "" : "s"} across ${new Set(selected.map((r) => r.leagueId)).size} leagues`}
              summary={
                starters || prot ? (
                  <b style={{ color: "var(--amber)" }}>
                    ⚠ Includes {starters ? `${starters} current starter${starters === 1 ? "" : "s"}` : ""}
                    {starters && prot ? " and " : ""}
                    {prot ? `${prot} Priority-list player${prot === 1 ? "" : "s"}` : ""} — released players go to waivers and may be claimed.
                  </b>
                ) : (
                  "Released players go to waivers and may be claimed by other teams."
                )
              }
              lines={selected.map((r) => (
                <span key={r.key}>
                  {r.leagueName}: release {nameOf(r.playerId)} ({r.where})
                </span>
              ))}
              confirmLabel={`Release ${selected.length}`}
              onConfirm={start}
              onCancel={() => setConfirming(false)}
            />
          )}
          {summary && (
            <p className="hint" style={{ color: summaryColor ?? "var(--bone)", fontWeight: summaryColor ? 650 : undefined }}>
              {summary}
            </p>
          )}
          <div className="mgrtable-scroll">
            <DataTable>
              <TableHeaderRow>
                <span style={{ width: 22 }} />
                <span style={{ flex: 1 }}>Player · League</span>
                <span style={{ minWidth: 110 }}>Where</span>
                <span style={{ minWidth: 90 }}>Result</span>
              </TableHeaderRow>
              {visible.map((r) => {
                const e = pmap?.[r.playerId];
                return (
                  <TableRow key={r.key} style={finished(r) ? { opacity: 0.6 } : undefined}>
                    <input
                      type="checkbox"
                      checked={isPicked(r) && !finished(r)}
                      disabled={running || finished(r)}
                      onChange={(ev) => setPicked((p) => ({ ...p, [r.key]: ev.target.checked }))}
                    />
                    <PlayerAvatar playerId={r.playerId} pos={e?.p} size={24} />
                    <span className="tname" style={{ flex: 1 }}>
                      {e?.n ?? r.playerId}
                      {e?.p && <span className="pos" style={{ ...posChipStyle(e.p), marginLeft: 6 }}>{e.p}</span>}
                      {r.priority && <span className="portmeta" style={{ marginLeft: 6, color: "var(--amber)" }}>★ Priority</span>}
                      <span className="portmeta" style={{ display: "block", fontWeight: 400 }}>{r.leagueName}</span>
                    </span>
                    <span className="portmeta" style={{ minWidth: 110, color: r.where === "starting" ? "var(--amber)" : undefined }}>
                      {r.where === "starting" ? "starting" : r.where === "IR" ? "on IR" : "bench"}
                    </span>
                    <StatusCell status={status[r.key]} />
                  </TableRow>
                );
              })}
            </DataTable>
          </div>
        </>
      )}
    </section>
  );
}
