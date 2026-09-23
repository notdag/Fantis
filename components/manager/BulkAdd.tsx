"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanLeague } from "@/lib/bulkPlan";
import { buildMultiAddPlan, type LeagueBudgetWarning, type MultiAddRow } from "@/lib/multiAddPlan";
import { suggestBid, type FaabStats } from "@/lib/faabHistory";
import { getTrendingAdds } from "@/lib/sleeper";
import { runBulk, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { addDropFreeAgent, claimWaiver } from "@/lib/sleeperWrite";
import { posChipStyle } from "@/lib/players";
import type { PlayerMap } from "@/lib/types";
import type { PlayerPrefs } from "@/lib/playerPrefs";
import type { LineupLeague } from "./LineupManager";
import { PlayerAvatar } from "./Avatar";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useRefreshLeagues } from "./useRefreshLeagues";
import { useDropRank } from "./useDropRank";

interface Target {
  id: string;
  n: string;
  p: string;
  t: string;
}

const MAX_TARGETS = 8;

function nameOf(pmap: PlayerMap | null, id: string | null): string {
  if (!id) return "—";
  return pmap?.[id]?.n ?? id;
}

// Multi-target add/claim board: pick several players, see a grid of where
// each is available, and run every add/claim across every league in one
// pass. When two targets both land in a full roster in the same league,
// each proposed drop is a DISTINCT bench player (lib/multiAddPlan.ts) —
// nobody is ever proposed to drop the same player twice.
export default function BulkAdd({
  leagues,
  pmap,
  token,
  prefs,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  prefs: PlayerPrefs;
}) {
  const rank = useDropRank(pmap);
  const isPriority = useMemo(() => new Set(prefs.priority), [prefs.priority]);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [rosteredByTarget, setRosteredByTarget] = useState<Record<string, Set<string>> | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [availError, setAvailError] = useState("");

  const [faabStats, setFaabStats] = useState<FaabStats | null>(null);
  useEffect(() => {
    // Real past winning bids for this account's leagues — used to suggest a
    // starting bid instead of always defaulting to the league's minimum.
    fetch("/api/manager/faab-suggest")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { stats?: FaabStats } | null) => setFaabStats(body?.stats ?? null))
      .catch(() => setFaabStats(null));
  }, []);

  const [trending, setTrending] = useState<{ id: string; n: string; p: string; t: string; count: number }[] | null>(null);
  const [trendingOpen, setTrendingOpen] = useState(false);
  const [trendingError, setTrendingError] = useState("");
  const trendingFetched = useRef(false);
  const loadTrending = () => {
    setTrendingOpen((v) => !v);
    if (trendingFetched.current || !pmap) return;
    trendingFetched.current = true;
    getTrendingAdds(24, 25)
      .then((rows) =>
        setTrending(
          rows
            .map((r) => {
              const e = pmap[r.player_id];
              return e ? { id: r.player_id, n: e.n, p: e.p, t: e.t, count: r.count } : null;
            })
            .filter((x): x is { id: string; n: string; p: string; t: string; count: number } => !!x)
        )
      )
      .catch(() => setTrendingError("Couldn't load trending adds from Sleeper."));
  };

  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [dropOverride, setDropOverride] = useState<Record<string, string | null>>({});
  const [bidOverride, setBidOverride] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const abortRef = useRef({ aborted: false });
  const refresh = useRefreshLeagues();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!pmap || q.length < 2) return [];
    const already = new Set(targets.map((t) => t.id));
    const out: Target[] = [];
    for (const [id, e] of Object.entries(pmap)) {
      if (already.has(id) || !e.t || !["QB", "RB", "WR", "TE", "K", "DEF"].includes(e.p)) continue;
      if (e.n.toLowerCase().includes(q)) out.push({ id, n: e.n, p: e.p, t: e.t });
      if (out.length >= 8) break;
    }
    return out;
  }, [pmap, query, targets]);

  // Availability is re-fetched from the event that actually changed the
  // target list (a click), never from an effect reacting to it — the same
  // pattern the rest of this file's fetches already use. A request id guards
  // against an older, slower request overwriting a newer one's result.
  const availReq = useRef(0);
  const refetchAvailability = async (list: Target[]) => {
    if (list.length === 0) return;
    const reqId = ++availReq.current;
    setLoadingAvail(true);
    setAvailError("");
    try {
      const res = await fetch(`/api/manager/availability?playerIds=${list.map((t) => encodeURIComponent(t.id)).join(",")}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't check availability.");
      if (reqId !== availReq.current) return; // superseded by a newer request
      const map: Record<string, Set<string>> = {};
      for (const [id, leagueIds] of Object.entries(body.rosteredLeagueIdsByPlayer as Record<string, string[]>)) {
        map[id] = new Set(leagueIds);
      }
      setRosteredByTarget(map);
    } catch (e) {
      if (reqId === availReq.current) setAvailError(e instanceof Error ? e.message : "Couldn't check availability.");
    } finally {
      if (reqId === availReq.current) setLoadingAvail(false);
    }
  };

  const addTarget = (t: Target) => {
    if (targets.some((x) => x.id === t.id) || targets.length >= MAX_TARGETS) {
      setQuery("");
      return;
    }
    const next = [...targets, t];
    setTargets(next);
    setQuery("");
    void refetchAvailability(next);
  };
  const removeTarget = (id: string) => {
    const next = targets.filter((t) => t.id !== id);
    setTargets(next);
    setDeselected(new Set());
    setDropOverride({});
    setBidOverride({});
    setStatus({});
    setSummary("");
    if (next.length > 0) void refetchAvailability(next);
    else setRosteredByTarget(null);
  };
  const clearTargets = () => {
    availReq.current++; // invalidate any in-flight request
    setTargets([]);
    setRosteredByTarget(null);
    setDeselected(new Set());
    setDropOverride({});
    setBidOverride({});
    setStatus({});
    setSummary("");
  };

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

  const { rows, budgetWarnings } = useMemo<{ rows: MultiAddRow[]; budgetWarnings: LeagueBudgetWarning[] }>(() => {
    if (targets.length === 0 || !rosteredByTarget) return { rows: [], budgetWarnings: [] };
    return buildMultiAddPlan(
      targets.map((t) => t.id),
      planLeagues,
      rosteredByTarget,
      rank,
      (leagueId, targetId, bidMin) => {
        const pos = pmap?.[targetId]?.p ?? "";
        return suggestBid(faabStats, leagueId, pos, bidMin, bidMin).bid;
      },
      (id) => isPriority.has(id)
    );
  }, [targets, rosteredByTarget, planLeagues, rank, faabStats, pmap, isPriority]);

  // League x target grid — only leagues where at least one target is either
  // addable or already rostered by you/someone else are worth a row.
  const gridLeagues = useMemo(() => {
    if (targets.length === 0 || !rosteredByTarget) return [];
    const rowByKey = new Map(rows.map((r) => [r.key, r]));
    return planLeagues
      .map((lg) => {
        const cells = targets.map((t) => {
          const already = rosteredByTarget[t.id]?.has(lg.leagueId);
          const r = rowByKey.get(`${lg.leagueId}:${t.id}`);
          return { target: t, already, row: r };
        });
        return { leagueId: lg.leagueId, leagueName: lg.leagueName, cells };
      })
      .filter((l) => l.cells.some((c) => c.row || c.already));
  }, [targets, rosteredByTarget, rows, planLeagues]);

  const dropFor = (r: MultiAddRow) => (r.key in dropOverride ? dropOverride[r.key] : r.dropId);
  const bidFor = (r: MultiAddRow) => {
    const raw = r.key in bidOverride ? bidOverride[r.key] : r.bid;
    const capped = r.budgetLeft != null ? Math.min(raw, r.budgetLeft) : raw;
    return Math.max(r.bidMin, Math.trunc(capped));
  };
  const finished = (r: MultiAddRow) => status[r.key]?.kind === "done";
  const runnable = (r: MultiAddRow) => !finished(r) && (!r.full || !!dropFor(r));
  const selectedRows = rows.filter((r) => !deselected.has(r.key) && runnable(r));

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
        const drop = r.full ? dropFor(r) ?? undefined : undefined;
        try {
          await addDropFreeAgent(token, { leagueId: r.leagueId, rosterId: r.rosterId, addPlayerId: r.targetId, dropPlayerId: drop });
          return drop ? `added ${nameOf(pmap, r.targetId)}, dropped ${nameOf(pmap, drop)}` : `added ${nameOf(pmap, r.targetId)}`;
        } catch (e) {
          // A player still on waivers can't be a straight add — Sleeper says
          // so in its error text; fall back to a waiver claim with the bid.
          if (e instanceof Error && /waiver/i.test(e.message)) {
            await claimWaiver(token, {
              leagueId: r.leagueId,
              rosterId: r.rosterId,
              addPlayerId: r.targetId,
              dropPlayerId: drop,
              bid: bidFor(r),
            });
            return `waiver claim ${nameOf(pmap, r.targetId)}${r.faab ? ` $${bidFor(r)}` : ""}`;
          }
          throw e;
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
    // rosters reflect it right away (keys are "leagueId:playerId").
    const refreshed = result.done > 0 ? await refresh(doneKeys.map((k) => k.split(":")[0])) : null;
    setSummary(
      `${result.done} succeeded${result.failed ? `, ${result.failed} failed` : ""}${
        result.skipped ? `, ${result.skipped} skipped` : ""
      }.${result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : ""}` +
        (refreshed === null ? "" : refreshed ? " Fantis's data was refreshed for those leagues." : " Couldn't auto-refresh Fantis's data — press Refresh (top right).")
    );
  };

  if (!pmap) return <p className="hint">Loading players…</p>;

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Pick up to {MAX_TARGETS} players and see where each is available, side by side. If a league&rsquo;s
        active roster is full, Fantis proposes dropping your lowest-value bench player (never a starter or
        someone on IR) — and if two targets both need a drop in the same league, they&rsquo;re never
        proposed to drop the same player. Availability comes from Fantis&rsquo;s last sync — Sleeper has the
        final say when a move is sent.
      </p>
      <div className="field" style={{ marginBottom: 8, alignItems: "center" }}>
        <input
          className="input"
          placeholder={targets.length >= MAX_TARGETS ? `Up to ${MAX_TARGETS} targets — remove one to add another` : "Search a player…"}
          value={query}
          disabled={targets.length >= MAX_TARGETS}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <button className="ccexample" onClick={loadTrending}>{trendingOpen ? "Hide trending" : "Trending adds"}</button>
        {targets.length > 0 && (
          <button className="ccexample" onClick={clearTargets}>Clear all targets</button>
        )}
      </div>
      {results.length > 0 && (
        <DataTable>
          {results.map((p) => (
            <TableRow as="button" key={p.id} onClick={() => addTarget(p)}>
              <PlayerAvatar playerId={p.id} pos={p.p} size={24} />
              <span className="tname" style={{ flex: 1 }}>{p.n}</span>
              <span className="pos" style={posChipStyle(p.p)}>{p.p}</span>
              <span className="portmeta">{p.t}</span>
            </TableRow>
          ))}
        </DataTable>
      )}

      {trendingOpen && (
        <div className="card sync" style={{ marginTop: 8, marginBottom: 8, maxWidth: "none" }}>
          <p className="hint" style={{ margin: "0 0 8px" }}>
            Sleeper&rsquo;s own most-added players across the platform in the last 24h — a real signal, not
            Fantis&rsquo;s pick. Click one to add it as a target.
          </p>
          {trendingError && <div className="err">{trendingError}</div>}
          {!trending && !trendingError && <p className="hint">Loading…</p>}
          {trending && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {trending.map((t) => (
                <button
                  key={t.id}
                  className="ccexample"
                  disabled={targets.some((x) => x.id === t.id) || targets.length >= MAX_TARGETS}
                  onClick={() => addTarget(t)}
                  title={`${t.count.toLocaleString()} adds in the last 24h`}
                >
                  + {t.n} <span className="portmeta">{t.p} · {t.t}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {targets.length > 0 && (
        <div className="field" style={{ margin: "10px 0", flexWrap: "wrap", gap: 8 }}>
          {targets.map((t) => (
            <span key={t.id} className="chip-filter on" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {t.n} <span className="portmeta" style={{ color: "inherit" }}>{t.p}</span>
              <button
                aria-label={`Remove ${t.n}`}
                onClick={() => removeTarget(t.id)}
                style={{ appearance: "none", border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 700, padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {targets.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <StatCardGrid variant="grid">
            <StatCard label="Targets" value={targets.length} />
            <StatCard label="Addable rows" value={loadingAvail ? "…" : rows.length} />
            <StatCard label="Need a drop" value={rows.filter((r) => r.full).length} valueColor={rows.some((r) => r.full) ? "var(--amber)" : undefined} />
          </StatCardGrid>
          {availError && <div className="err">{availError}</div>}

          {budgetWarnings.length > 0 && (
            <div className="card sync" style={{ marginTop: 10, marginBottom: 10, borderColor: "var(--amber)", maxWidth: "none" }}>
              <p className="hint" style={{ margin: 0, color: "var(--amber)", fontWeight: 600 }}>
                {budgetWarnings.length} league{budgetWarnings.length === 1 ? "" : "s"} where the combined suggested bids are more than what&rsquo;s left
              </p>
              {budgetWarnings.map((w) => (
                <p key={w.leagueId} className="hint" style={{ margin: "4px 0 0" }}>
                  {w.leagueName}: {w.targetCount} targets bidding ${w.totalBid} combined, only ${w.budgetLeft} left this season — adjust bids below before sending.
                </p>
              ))}
            </div>
          )}

          {gridLeagues.length > 0 && (
            <div style={{ marginTop: 10, marginBottom: 14, overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--line)" }} className="portmeta">League</th>
                    {targets.map((t) => (
                      <th key={t.id} style={{ textAlign: "center", padding: "6px 10px", borderBottom: "1px solid var(--line)" }} className="portmeta">{t.n}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gridLeagues.map((l) => (
                    <tr key={l.leagueId}>
                      <td style={{ padding: "5px 10px", borderBottom: "1px solid var(--line-soft)" }} className="tname">{l.leagueName}</td>
                      {l.cells.map((c) => (
                        <td key={c.target.id} style={{ padding: "5px 10px", borderBottom: "1px solid var(--line-soft)", textAlign: "center" }}>
                          {c.already ? (
                            <span className="portmeta" title="Already rostered by someone">✕</span>
                          ) : c.row?.full ? (
                            <span title={`Needs a drop: ${nameOf(pmap, dropFor(c.row))}`} style={{ color: "var(--amber)" }}>drop</span>
                          ) : c.row ? (
                            <span title="Open roster spot" style={{ color: "var(--mint)" }}>✓</span>
                          ) : (
                            <span className="portmeta">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="field" style={{ margin: "12px 0", alignItems: "center" }}>
                <button className="chip-filter" onClick={() => setDeselected(new Set())}>Select all</button>
                <button className="chip-filter" onClick={() => setDeselected(new Set(rows.map((r) => r.key)))}>Select none</button>
                <span style={{ flex: 1 }} />
                {running ? (
                  <button className="btn ghost" onClick={() => (abortRef.current.aborted = true)}>Abort</button>
                ) : (
                  <button className="btn" disabled={!token || selectedRows.length === 0 || confirming} onClick={() => setConfirming(true)}>
                    Add {selectedRows.length} across {new Set(selectedRows.map((r) => r.leagueId)).size} leagues
                  </button>
                )}
              </div>
              {!token && <p className="hint" style={{ color: "var(--red)" }}>Connect write access above first.</p>}

              {confirming && (
                <BulkConfirm
                  title={`${selectedRows.length} adds/claims across ${new Set(selectedRows.map((r) => r.leagueId)).size} leagues`}
                  lines={selectedRows.map((r) => (
                    <span key={r.key}>
                      {r.leagueName}: {nameOf(pmap, r.targetId)}
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
                    <span style={{ minWidth: 130 }}>Player</span>
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
                      <span className="tname" style={{ minWidth: 130 }}>{nameOf(pmap, r.targetId)}</span>
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
                            title={r.bid === bidFor(r) ? "Suggested from this league's own past winning bids" : undefined}
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
