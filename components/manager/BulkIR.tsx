"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { buildIrPlan, type IrRow, type PlanLeague } from "@/lib/bulkPlan";
import { runBulk, errorMessage, bulkResultTone, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { preflightRosters } from "@/lib/liveRosters";
import { activateFromIR, addDropFreeAgent, moveToIR, setStarters } from "@/lib/sleeperWrite";
import { posChipStyle } from "@/lib/players";
import type { PlayerMap } from "@/lib/types";
import type { PlayerPrefs } from "@/lib/playerPrefs";
import type { LineupLeague } from "./LineupManager";
import { PlayerAvatar } from "./Avatar";
import { Badge } from "./Badge";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useRefreshLeagues } from "./useRefreshLeagues";
import { useDropRank } from "./useDropRank";

const INJ_TONE = {
  color: "var(--red)",
  background: "color-mix(in srgb, var(--red) 20%, transparent)",
  borderColor: "color-mix(in srgb, var(--red) 52%, transparent)",
};

function nameOf(pmap: PlayerMap | null, id: string | null): string {
  if (!id) return "—";
  return pmap?.[id]?.n ?? id;
}

export default function BulkIR({
  leagues,
  pmap,
  token,
  currentWeek,
  prefs,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  currentWeek: number;
  prefs: PlayerPrefs;
}) {
  const rank = useDropRank(pmap);
  const isPriority = useCallback((id: string) => prefs.priority.includes(id), [prefs.priority]);

  const planLeagues = useMemo<PlanLeague[]>(
    () =>
      leagues
        .filter((l) => l.roster)
        .map((l) => ({
          leagueId: l.league.id,
          leagueName: l.league.name,
          rosterId: l.roster!.rosterId,
          settings: l.league.settings,
          starters: l.roster!.starters,
          players: l.roster!.players,
          reserve: l.roster!.reserve,
          faabUsed: l.roster!.faabUsed,
        })),
    [leagues]
  );

  const baseInjuryOf = useCallback((id: string) => pmap?.[id]?.inj ?? null, [pmap]);

  // Real, real-week judgment calls ("I think he'll play this week") to keep
  // OUT of this run entirely — a one-off, THIS-run-only exclude (re-pick him
  // next time if he's still hurt then), not a standing preference like
  // Priority/Avoid/Never Start/IR Release. Computed unfiltered here so the
  // search box can offer anyone genuinely eligible right now, independent of
  // who's currently excluded.
  const [keepQuery, setKeepQuery] = useState("");
  const [keepIds, setKeepIds] = useState<Set<string>>(new Set());
  const rawRows = useMemo(() => buildIrPlan(planLeagues, baseInjuryOf, rank, isPriority, prefs.irRelease), [planLeagues, baseInjuryOf, rank, isPriority, prefs.irRelease]);
  const keepCandidates = useMemo(() => {
    const seen = new Map<string, string>(); // playerId -> name, de-duped across leagues
    for (const r of rawRows) if (!seen.has(r.playerId)) seen.set(r.playerId, nameOf(pmap, r.playerId));
    return seen;
  }, [rawRows, pmap]);
  const keepResults = useMemo(() => {
    const q = keepQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: { id: string; name: string }[] = [];
    for (const [id, name] of keepCandidates) {
      if (keepIds.has(id)) continue;
      if (name.toLowerCase().includes(q)) out.push({ id, name });
      if (out.length >= 8) break;
    }
    return out;
  }, [keepCandidates, keepQuery, keepIds]);
  const addKeep = (id: string) => {
    setKeepIds((prev) => new Set(prev).add(id));
    setKeepQuery("");
  };
  const removeKeep = (id: string) => setKeepIds((prev) => { const n = new Set(prev); n.delete(id); return n; });

  // Excluding BEFORE the plan is built (not filtering rows after) is what
  // makes this correct: buildIrPlan assigns each league's open IR slots to
  // its eligible players in severity order, so if a kept player would have
  // sorted first, the slot has to go to the next real eligible player
  // instead — filtering the OUTPUT afterward would leave that slot wrongly
  // reported as taken. Same lesson as the chat "keep X on my bench" fix.
  const injuryOf = useCallback((id: string) => (keepIds.has(id) ? null : baseInjuryOf(id)), [keepIds, baseInjuryOf]);
  const rows = useMemo(() => buildIrPlan(planLeagues, injuryOf, rank, isPriority, prefs.irRelease), [planLeagues, injuryOf, rank, isPriority, prefs.irRelease]);
  // Leagues with a spare active roster spot: there, a full IR is fixed by SWAPPING — the IR player comes off IR to your bench
  // (no one is dropped) and the new player takes his IR slot. Net roster size is unchanged, so the spot stays spare.
  const benchRoom = useMemo(() => {
    const m = new Set<string>();
    for (const l of leagues) {
      if (!l.roster || l.rosterPositions.length === 0) continue;
      if (l.roster.players.length - l.roster.reserve.length < l.rosterPositions.length) m.add(l.league.id);
    }
    return m;
  }, [leagues]);

  // Everything is selected by default; the user un-checks. (Stored as the
  // deselected set so the default needs no effect/initialisation once the
  // async player map loads.)
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [rowFilter, setRowFilter] = useState("");
  const [dropOverride, setDropOverride] = useState<Record<string, string | null>>({});
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryColor, setSummaryColor] = useState("var(--bone)");
  const abortRef = useRef({ aborted: false });
  const refresh = useRefreshLeagues();

  // A full-IR row's choice: "bench:<id>" = move that IR player to your bench (swap, no drop), "<id>" = release him.
  const choiceFor = (r: IrRow): string | null =>
    r.key in dropOverride ? dropOverride[r.key] : r.dropId ? (benchRoom.has(r.leagueId) ? `bench:${r.dropId}` : r.dropId) : null;
  const dropFor = (r: IrRow) => {
    const c = choiceFor(r);
    return c ? c.replace(/^bench:/, "") : null;
  };
  const isBenchSwap = (r: IrRow) => (choiceFor(r) ?? "").startsWith("bench:");
  const finished = (r: IrRow) => status[r.key]?.kind === "done";
  const runnable = (r: IrRow) => !finished(r) && !r.noRoom && (!r.needsDrop || !!dropFor(r));
  const selectedRows = rows.filter((r) => !deselected.has(r.key) && runnable(r));
  const leaguesAffected = new Set(rows.map((r) => r.leagueId)).size;
  const dropCount = selectedRows.filter((r) => r.needsDrop && !isBenchSwap(r)).length;

  // Find a specific league or player in a long batch instead of scrolling
  // to it. Filters the VIEW only — Select all/none below act on whatever's
  // currently filtered in, real selection state for everything else is
  // untouched.
  const visibleRows = useMemo(() => {
    const q = rowFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.leagueName.toLowerCase().includes(q) || nameOf(pmap, r.playerId).toLowerCase().includes(q));
  }, [rows, rowFilter, pmap]);

  const selectVisible = () =>
    setDeselected((prev) => {
      const next = new Set(prev);
      for (const r of visibleRows) next.delete(r.key);
      return next;
    });
  const deselectVisible = () =>
    setDeselected((prev) => {
      const next = new Set(prev);
      for (const r of visibleRows) next.add(r.key);
      return next;
    });

  // One-click case: players Sleeper lists as "IR" that fit in an open IR slot.
  // Leagues whose IR is already full are never touched by this — they're
  // reported instead, so nothing gets dropped without you choosing it.
  const openRows = rows.filter((r) => !finished(r));
  const irQuick = openRows.filter((r) => !r.needsDrop); // every eligible player that fits
  const irStatusQuick = irQuick.filter((r) => r.injury === "IR"); // just Sleeper's literal "IR" status
  const irBlocked = openRows.filter((r) => r.needsDrop); // IR full in that league
  const blockedLeagues = new Set(irBlocked.map((r) => r.leagueId)).size;
  const moveOnly = (keepRows: IrRow[]) => {
    const keep = new Set(keepRows.map((r) => r.key));
    setDeselected(new Set(rows.filter((r) => !keep.has(r.key)).map((r) => r.key)));
    setConfirming(true);
  };

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

    // Pre-flight: re-read every affected roster from Sleeper first and set aside any league that changed since this plan was
    // built (so a drop/IR move you made in the Sleeper app is never undone or collided with). A row that has to clear a
    // starter's lineup slot also depends on the current lineup, so for those the starters must match too.
    setSummary("Checking every roster against Sleeper first…");
    const pre = await preflightRosters(
      selectedRows.map((r) => {
        const lg = planLeagues.find((l) => l.leagueId === r.leagueId);
        return {
          leagueId: r.leagueId,
          rosterId: r.rosterId,
          base: lg ? { starters: lg.starters, players: lg.players, reserve: lg.reserve } : null,
          strictStarters: !!r.inStarters,
        };
      })
    );
    setSummary("");

    const tasks: BulkTask[] = selectedRows.map((r) => ({
      key: r.key,
      run: async () => {
        const blocked = pre[r.leagueId]?.blocked;
        if (blocked) throw new Error(blocked);
        const out = r.needsDrop ? dropFor(r) : null;
        const toBench = !!out && isBenchSwap(r);
        const drop = toBench ? null : out;
        if (toBench && out) {
          await activateFromIR(token, { leagueId: r.leagueId, rosterId: r.rosterId, playerId: out });
        } else if (drop) {
          await addDropFreeAgent(token, { leagueId: r.leagueId, rosterId: r.rosterId, dropPlayerId: drop });
        }
        try {
          await moveToIR(token, { leagueId: r.leagueId, rosterId: r.rosterId, playerId: r.playerId });
          return toBench && out ? `moved ${nameOf(pmap, out)} to bench` : drop ? `dropped ${nameOf(pmap, drop)}` : undefined;
        } catch (e) {
          // A starter has to leave the lineup before Sleeper will IR him —
          // vacate that one slot and try once more.
          const lg = planLeagues.find((l) => l.leagueId === r.leagueId);
          if (r.inStarters && lg) {
            try {
              await setStarters(token, {
                leagueId: r.leagueId,
                rosterId: r.rosterId,
                starters: lg.starters.map((id) => (id === r.playerId ? "0" : id)),
                week: currentWeek,
              });
              await moveToIR(token, { leagueId: r.leagueId, rosterId: r.rosterId, playerId: r.playerId });
              return "cleared his lineup slot first";
            } catch (e2) {
              throw new Error(`${drop ? `Dropped ${nameOf(pmap, drop)}, but ` : ""}IR move failed: ${errorMessage(e2)}`);
            }
          }
          throw new Error(`${drop ? `Dropped ${nameOf(pmap, drop)}, but ` : ""}IR move failed: ${errorMessage(e)}`);
        }
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
    // Re-sync just the leagues that changed so the Action Queue, banners and
    // rosters reflect it right away (keys are "leagueId" or "leagueId:playerId").
    const refreshed = result.done > 0 ? await refresh(doneKeys.map((k) => k.split(":")[0])) : null;
    const tone = bulkResultTone(result);
    setSummaryColor(tone.color);
    setSummary(
      `${tone.prefix}${result.done} moved${result.failed ? `, ${result.failed} failed` : ""}${
        result.skipped ? `, ${result.skipped} skipped` : ""
      }.${result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : ""}` +
        (refreshed === null ? "" : refreshed ? " Fantis's data was refreshed for those leagues." : " Couldn't auto-refresh Fantis's data — press Refresh (top right).")
    );
  };

  if (!pmap) return <p className="hint">Loading players…</p>;

  return (
    <>
      <StatCardGrid variant="grid">
        <StatCard label="Leagues affected" value={leaguesAffected} />
        <StatCard label="Players to move" value={rows.length} />
        <StatCard
          label="Need a drop first"
          value={rows.filter((r) => r.needsDrop).length}
          valueColor={rows.some((r) => r.needsDrop) ? "var(--amber)" : undefined}
        />
      </StatCardGrid>
      <p className="hint" style={{ margin: "8px 0 12px" }}>
        Out, IR, NA and other ruled-out players your league&rsquo;s own IR rules allow, one row each
        (Doubtful players are never included). When a league&rsquo;s
        IR is full, Fantis proposes dropping the lowest-value player currently on IR (dropping a
        bench player wouldn&rsquo;t free an IR slot) — change any pick, or uncheck the row.
      </p>

      <div className="field" style={{ marginBottom: 8, alignItems: "center" }}>
        <input
          className="input"
          placeholder="Keep someone on the bench instead — search a player…"
          value={keepQuery}
          onChange={(e) => setKeepQuery(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </div>
      {keepResults.length > 0 && (
        <DataTable>
          {keepResults.map((r) => (
            <TableRow as="button" key={r.id} onClick={() => addKeep(r.id)}>
              <PlayerAvatar playerId={r.id} pos={pmap[r.id]?.p} size={24} />
              <span className="tname" style={{ flex: 1 }}>{r.name}</span>
              <span className="portmeta">keep on bench, not IR — this run only</span>
            </TableRow>
          ))}
        </DataTable>
      )}
      {keepIds.size > 0 && (
        <div className="field" style={{ margin: "10px 0", flexWrap: "wrap", gap: 8 }}>
          <span className="portmeta">Kept on bench this run:</span>
          {[...keepIds].map((id) => (
            <span key={id} className="chip-filter on" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {nameOf(pmap, id)}
              <button
                aria-label={`Stop keeping ${nameOf(pmap, id)} on the bench`}
                onClick={() => removeKeep(id)}
                style={{ appearance: "none", border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 700, padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="hint">No injured players eligible for IR in any league right now.</p>
      ) : (
        <>
          <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
            <input
              className="input"
              placeholder="Find a league or player…"
              value={rowFilter}
              onChange={(e) => setRowFilter(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <button className="chip-filter" onClick={selectVisible}>Select all{rowFilter ? " shown" : ""}</button>
            <button className="chip-filter" onClick={deselectVisible}>Select none{rowFilter ? " shown" : ""}</button>
            <span style={{ flex: 1 }} />
            {!running && (
              <>
                <button className="btn ghost" disabled={!token || irStatusQuick.length === 0 || confirming} onClick={() => moveOnly(irStatusQuick)}>
                  IR-status only ({irStatusQuick.length})
                </button>
                <button className="btn" disabled={!token || irQuick.length === 0 || confirming} onClick={() => moveOnly(irQuick)}>
                  Move all eligible to IR ({irQuick.length})
                </button>
              </>
            )}
            {running ? (
              <button className="btn ghost" onClick={() => (abortRef.current.aborted = true)}>Abort</button>
            ) : (
              <button
                className="btn"
                disabled={!token || selectedRows.length === 0 || confirming}
                onClick={() => setConfirming(true)}
              >
                Move {selectedRows.length} to IR
              </button>
            )}
          </div>
          {!token && <p className="hint" style={{ color: "var(--red)" }}>Connect write access above first.</p>}

          {confirming && (
            <BulkConfirm
              title={`Move ${selectedRows.length} players to IR across ${new Set(selectedRows.map((r) => r.leagueId)).size} leagues${
                dropCount ? ` — including ${dropCount} drop${dropCount === 1 ? "" : "s"}` : ""
              }`}
              lines={selectedRows.map((r) => (
                <span key={r.key}>
                  {r.leagueName}: {nameOf(pmap, r.playerId)} → IR
                  {r.needsDrop && <strong> · {isBenchSwap(r) ? `move ${nameOf(pmap, dropFor(r))} to bench` : `release ${nameOf(pmap, dropFor(r))}`}</strong>}
                </span>
              ))}
              confirmLabel={`Send ${selectedRows.length} changes to Sleeper`}
              onConfirm={start}
              onCancel={() => setConfirming(false)}
            />
          )}
          {irBlocked.length > 0 && (
            <div className="card sync" style={{ marginBottom: 12, borderColor: "var(--amber)" }}>
              <p className="hint" style={{ margin: 0, color: "var(--amber)", fontWeight: 600 }}>
                {blockedLeagues} league{blockedLeagues === 1 ? "" : "s"} already ha{blockedLeagues === 1 ? "s" : "ve"} IR full
              </p>
              <p className="hint" style={{ margin: "6px 0 0" }}>
                {irBlocked.length} eligible player{irBlocked.length === 1 ? "" : "s"} can&rsquo;t go to IR without
                dropping someone, so the quick buttons skip them:{" "}
                {irBlocked.slice(0, 6).map((r) => `${nameOf(pmap, r.playerId)} (${r.leagueName})`).join("; ")}
                {irBlocked.length > 6 ? ` and ${irBlocked.length - 6} more` : ""}. To include one, pick who to drop
                in its row below and check it.
              </p>
            </div>
          )}
          {summary && <p className="hint" style={{ color: summaryColor, fontWeight: 600 }}>{summary}</p>}
          {rowFilter && <p className="hint" style={{ margin: "0 0 8px" }}>{visibleRows.length} of {rows.length} rows match &ldquo;{rowFilter}&rdquo;</p>}

          <div className="mgrtable-scroll">
            <DataTable>
              <TableHeaderRow>
                <span style={{ width: 22 }} />
                <span style={{ flex: 1 }}>League · player</span>
                <span style={{ minWidth: 200 }}>Action</span>
                <span style={{ minWidth: 90 }}>Result</span>
              </TableHeaderRow>
              {visibleRows.map((r) => {
                const entry = pmap[r.playerId];
                return (
                  <TableRow key={r.key} style={finished(r) ? { opacity: 0.6 } : undefined}>
                    <input
                      type="checkbox"
                      checked={!deselected.has(r.key) && runnable(r)}
                      disabled={!runnable(r) || running}
                      onChange={() => toggle(r.key)}
                    />
                    <PlayerAvatar playerId={r.playerId} pos={entry?.p} size={24} />
                    <span className="tname" style={{ flex: 1 }}>
                      {entry?.n ?? r.playerId}
                      {entry?.p && <span className="pos" style={{ ...posChipStyle(entry.p), marginLeft: 6 }}>{entry.p}</span>}
                      <span className="portmeta" style={{ display: "block", fontWeight: 400 }}>{r.leagueName}</span>
                    </span>
                    <Badge tone={INJ_TONE}>{r.injury}</Badge>
                    <span style={{ minWidth: 200 }}>
                      {r.noRoom ? (
                        <span className="portmeta" style={{ color: "var(--red)" }}>IR full, nobody to drop</span>
                      ) : r.needsDrop ? (
                        <select
                          className="select sm"
                          value={choiceFor(r) ?? ""}
                          disabled={running || finished(r)}
                          onChange={(e) => setDropOverride((p) => ({ ...p, [r.key]: e.target.value || null }))}
                          title="IR is full — choose who on IR makes room"
                        >
                          <option value="">— IR full: pick who makes room —</option>
                          {benchRoom.has(r.leagueId) &&
                            r.dropCandidates.map((id) => (
                              <option key={`b${id}`} value={`bench:${id}`}>
                                swap: {nameOf(pmap, id)} → bench{pmap?.[id]?.inj ? ` (${pmap[id].inj})` : " (healthy)"}
                              </option>
                            ))}
                          {r.dropCandidates.map((id) => (
                            <option key={id} value={id}>
                              release {nameOf(pmap, id)}{pmap?.[id]?.inj ? ` (${pmap[id].inj})` : " (healthy)"}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="portmeta">→ IR{r.inStarters ? " (in lineup)" : ""}</span>
                      )}
                    </span>
                    <StatusCell status={status[r.key]} />
                  </TableRow>
                );
              })}
            </DataTable>
          </div>
        </>
      )}
    </>
  );
}
