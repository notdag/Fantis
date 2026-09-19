"use client";

import { useMemo, useRef, useState } from "react";
import { buildAddPlan, type AddRow, type PlanLeague } from "@/lib/bulkPlan";
import { runBulk, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { addDropFreeAgent, claimWaiver } from "@/lib/sleeperWrite";
import { posChipStyle } from "@/lib/players";
import type { PlayerMap } from "@/lib/types";
import type { LineupLeague } from "./LineupManager";
import { PlayerAvatar } from "./Avatar";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useDropRank } from "./useDropRank";

function nameOf(pmap: PlayerMap | null, id: string | null): string {
  if (!id) return "—";
  return pmap?.[id]?.n ?? id;
}

export default function BulkAdd({
  leagues,
  pmap,
  token,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
}) {
  const rank = useDropRank(pmap);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [rostered, setRostered] = useState<Set<string> | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [availError, setAvailError] = useState("");

  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [dropOverride, setDropOverride] = useState<Record<string, string | null>>({});
  const [bidOverride, setBidOverride] = useState<Record<string, number>>({});
  const [globalBid, setGlobalBid] = useState(0);
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const abortRef = useRef({ aborted: false });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!pmap || q.length < 2) return [];
    const out: { id: string; n: string; p: string; t: string }[] = [];
    for (const [id, e] of Object.entries(pmap)) {
      if (!e.t || !["QB", "RB", "WR", "TE", "K", "DEF"].includes(e.p)) continue;
      if (e.n.toLowerCase().includes(q)) out.push({ id, n: e.n, p: e.p, t: e.t });
      if (out.length >= 8) break;
    }
    return out;
  }, [pmap, query]);

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

  const rows = useMemo(
    () => (target && rostered ? buildAddPlan(target, planLeagues, rostered, rank) : []),
    [target, rostered, planLeagues, rank]
  );

  const pick = async (id: string) => {
    setTarget(id);
    setRostered(null);
    setAvailError("");
    setDeselected(new Set());
    setDropOverride({});
    setBidOverride({});
    setStatus({});
    setSummary("");
    setLoadingAvail(true);
    try {
      const res = await fetch(`/api/manager/availability?playerId=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't check availability.");
      setRostered(new Set<string>(body.rosteredLeagueIds));
    } catch (e) {
      setAvailError(e instanceof Error ? e.message : "Couldn't check availability.");
    } finally {
      setLoadingAvail(false);
    }
  };

  const dropFor = (r: AddRow) => (r.key in dropOverride ? dropOverride[r.key] : r.dropId);
  const bidFor = (r: AddRow) => {
    const raw = r.key in bidOverride ? bidOverride[r.key] : globalBid;
    const capped = r.budgetLeft != null ? Math.min(raw, r.budgetLeft) : raw;
    return Math.max(r.bidMin, Math.trunc(capped));
  };
  const finished = (r: AddRow) => status[r.key]?.kind === "done";
  const runnable = (r: AddRow) => !finished(r) && (!r.full || !!dropFor(r));
  const selectedRows = rows.filter((r) => !deselected.has(r.key) && runnable(r));

  const toggle = (key: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const start = async () => {
    if (!token || !target) return;
    setConfirming(false);
    setRunning(true);
    setSummary("");
    abortRef.current = { aborted: false };

    const tasks: BulkTask[] = selectedRows.map((r) => ({
      key: r.key,
      run: async () => {
        const drop = r.full ? dropFor(r) ?? undefined : undefined;
        try {
          await addDropFreeAgent(token, { leagueId: r.leagueId, rosterId: r.rosterId, addPlayerId: r.playerId, dropPlayerId: drop });
          return drop ? `added, dropped ${nameOf(pmap, drop)}` : "added";
        } catch (e) {
          // A player still on waivers can't be a straight add — Sleeper says
          // so in its error text; fall back to a waiver claim with the bid.
          if (e instanceof Error && /waiver/i.test(e.message)) {
            await claimWaiver(token, {
              leagueId: r.leagueId,
              rosterId: r.rosterId,
              addPlayerId: r.playerId,
              dropPlayerId: drop,
              bid: bidFor(r),
            });
            return `waiver claim${r.faab ? ` $${bidFor(r)}` : ""}`;
          }
          throw e;
        }
      },
    }));

    const result = await runBulk(tasks, {
      signal: abortRef.current,
      onStatus: (key, s) => setStatus((prev) => ({ ...prev, [key]: s })),
    });
    setRunning(false);
    setSummary(
      `${result.done} succeeded${result.failed ? `, ${result.failed} failed` : ""}${
        result.skipped ? `, ${result.skipped} skipped` : ""
      }.${result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : ""}` +
        (result.done ? " Run Sync now on the Command Center to refresh Fantis's own data before another pass." : "")
    );
  };

  if (!pmap) return <p className="hint">Loading players…</p>;

  const targetEntry = target ? pmap[target] : null;

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Pick one player and add or claim him in every league where he&rsquo;s still available. If a
        league&rsquo;s active roster is full, Fantis proposes dropping your lowest-value bench player
        (never a starter or someone on IR). Availability comes from Fantis&rsquo;s last sync — Sleeper
        has the final say when the move is sent.
      </p>
      <div className="field" style={{ marginBottom: 8 }}>
        <input
          className="input"
          placeholder="Search a player…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 280 }}
        />
      </div>
      {results.length > 0 && (
        <DataTable>
          {results.map((p) => (
            <TableRow as="button" key={p.id} onClick={() => { pick(p.id); setQuery(""); }}>
              <PlayerAvatar playerId={p.id} pos={p.p} size={24} />
              <span className="tname" style={{ flex: 1 }}>{p.n}</span>
              <span className="pos" style={posChipStyle(p.p)}>{p.p}</span>
              <span className="portmeta">{p.t}</span>
            </TableRow>
          ))}
        </DataTable>
      )}

      {target && (
        <div style={{ marginTop: 16 }}>
          <StatCardGrid variant="grid">
            <StatCard label="Adding" value={targetEntry?.n ?? target} />
            <StatCard label="Available in" value={loadingAvail ? "…" : `${rows.length} leagues`} />
            <StatCard label="Need a drop" value={rows.filter((r) => r.full).length} valueColor={rows.some((r) => r.full) ? "var(--amber)" : undefined} />
          </StatCardGrid>
          {availError && <div className="err">{availError}</div>}

          {rows.length > 0 && (
            <>
              <div className="field" style={{ margin: "12px 0", alignItems: "center" }}>
                <button className="chip-filter" onClick={() => setDeselected(new Set())}>Select all</button>
                <button className="chip-filter" onClick={() => setDeselected(new Set(rows.map((r) => r.key)))}>Select none</button>
                <label className="portmeta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  FAAB bid (all)
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={globalBid}
                    onChange={(e) => setGlobalBid(Number(e.target.value) || 0)}
                    style={{ width: 80 }}
                  />
                </label>
                <span style={{ flex: 1 }} />
                {running ? (
                  <button className="btn ghost" onClick={() => (abortRef.current.aborted = true)}>Abort</button>
                ) : (
                  <button className="btn" disabled={!token || selectedRows.length === 0 || confirming} onClick={() => setConfirming(true)}>
                    Add to {selectedRows.length} leagues
                  </button>
                )}
              </div>
              {!token && <p className="hint" style={{ color: "var(--red)" }}>Connect write access above first.</p>}

              {confirming && (
                <BulkConfirm
                  title={`Add ${targetEntry?.n ?? "player"} in ${selectedRows.length} leagues`}
                  lines={selectedRows.map((r) => (
                    <span key={r.key}>
                      {r.leagueName}
                      {r.full && <strong> · drop {nameOf(pmap, dropFor(r))}</strong>}
                      {r.faab && ` · bid up to $${bidFor(r)} if on waivers`}
                    </span>
                  ))}
                  confirmLabel={`Send ${selectedRows.length} changes to Sleeper`}
                  onConfirm={start}
                  onCancel={() => setConfirming(false)}
                />
              )}
              {summary && <p className="hint" style={{ color: "var(--bone)" }}>{summary}</p>}

              <div style={{ maxHeight: 640, overflowY: "auto" }}>
                <DataTable>
                  <TableHeaderRow>
                    <span style={{ width: 22 }} />
                    <span style={{ flex: 1 }}>League</span>
                    <span style={{ minWidth: 200 }}>Roster</span>
                    <span style={{ minWidth: 70 }}>Bid</span>
                    <span style={{ minWidth: 90 }}>Result</span>
                  </TableHeaderRow>
                  {rows.map((r) => (
                    <TableRow key={r.key} style={finished(r) ? { opacity: 0.6 } : undefined}>
                      <input
                        type="checkbox"
                        checked={!deselected.has(r.key) && runnable(r)}
                        disabled={!runnable(r) || running}
                        onChange={() => toggle(r.key)}
                      />
                      <span className="tname" style={{ flex: 1 }}>{r.leagueName}</span>
                      <span style={{ minWidth: 200 }}>
                        {r.full ? (
                          <select
                            className="select sm"
                            value={dropFor(r) ?? ""}
                            disabled={running || finished(r)}
                            onChange={(e) => setDropOverride((p) => ({ ...p, [r.key]: e.target.value || null }))}
                          >
                            <option value="">— pick who to drop —</option>
                            {r.dropCandidates.map((id) => (
                              <option key={id} value={id}>drop {nameOf(pmap, id)}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="portmeta">open spot</span>
                        )}
                      </span>
                      <span style={{ minWidth: 70 }}>
                        {r.faab ? (
                          <input
                            className="input"
                            type="number"
                            min={r.bidMin}
                            max={r.budgetLeft ?? undefined}
                            value={bidFor(r)}
                            disabled={running || finished(r)}
                            onChange={(e) => setBidOverride((p) => ({ ...p, [r.key]: Number(e.target.value) || 0 }))}
                            style={{ width: 64 }}
                          />
                        ) : (
                          <span className="portmeta">—</span>
                        )}
                      </span>
                      <StatusCell status={status[r.key]} />
                    </TableRow>
                  ))}
                </DataTable>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
