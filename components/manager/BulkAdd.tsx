"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanLeague } from "@/lib/bulkPlan";
import type { Claim } from "@/lib/inbox";
import { buildMultiAddPlan, type LeagueBudgetWarning, type MultiAddRow } from "@/lib/multiAddPlan";
import { suggestBid, type FaabStats } from "@/lib/faabHistory";
import { getTrendingAdds } from "@/lib/sleeper";
import { runBulk, bulkResultTone, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { addDropFreeAgent, claimWaiver } from "@/lib/sleeperWrite";
import { preflightRosters } from "@/lib/liveRosters";
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
  claimsByLeague,
  liveRostered,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  prefs: PlayerPrefs;
  // Real pending waiver claims already sitting in each league, keyed by
  // leagueId — optional so callers that haven't scanned for claims (Lineups,
  // Open Spots) render exactly as before. Shown per-row here rather than
  // only in a separate collective list, since a claim only matters when
  // you can tell which specific row/league it belongs to.
  claimsByLeague?: Map<string, Claim[]>;
  // Everyone rostered by ANY team in each league, read live from Sleeper (the Lineups page supplies this). When present
  // it overrides the stored availability for those leagues, so "is he still free?" reflects right now, not the last sync.
  liveRostered?: Record<string, ReadonlySet<string>>;
}) {
  const rank = useDropRank(pmap);
  const isPriority = useMemo(() => new Set(prefs.priority), [prefs.priority]);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [rosteredByTarget, setRosteredByTarget] = useState<Record<string, Set<string>> | null>(null);
  // Stored availability, corrected by the live reads where we have them (a league without a live read keeps the stored answer).
  const rosteredEff = useMemo(() => {
    if (!rosteredByTarget) return null;
    if (!liveRostered) return rosteredByTarget;
    const out: Record<string, Set<string>> = {};
    for (const [pid, leagueIds] of Object.entries(rosteredByTarget)) {
      const s = new Set<string>();
      for (const lid of leagueIds) if (!liveRostered[lid]) s.add(lid);
      for (const [lid, all] of Object.entries(liveRostered)) if (all.has(pid)) s.add(lid);
      out[pid] = s;
    }
    return out;
  }, [rosteredByTarget, liveRostered]);
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
  const [rowFilter, setRowFilter] = useState("");
  const [bulkBid, setBulkBid] = useState<number | "">("");
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryColor, setSummaryColor] = useState("var(--bone)");
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
    if (targets.length === 0 || !rosteredEff) return { rows: [], budgetWarnings: [] };
    return buildMultiAddPlan(
      targets.map((t) => t.id),
      planLeagues,
      rosteredEff,
      rank,
      (leagueId, targetId, bidMin) => {
        const pos = pmap?.[targetId]?.p ?? "";
        return suggestBid(faabStats, leagueId, pos, bidMin, bidMin).bid;
      },
      (id) => isPriority.has(id)
    );
  }, [targets, rosteredEff, planLeagues, rank, faabStats, pmap, isPriority]);

  // League x target grid — only leagues where at least one target is either
  // addable or already rostered by you/someone else are worth a row.
  const gridLeagues = useMemo(() => {
    if (targets.length === 0 || !rosteredEff) return [];
    const rowByKey = new Map(rows.map((r) => [r.key, r]));
    return planLeagues
      .map((lg) => {
        const cells = targets.map((t) => {
          const already = rosteredEff[t.id]?.has(lg.leagueId);
          const r = rowByKey.get(`${lg.leagueId}:${t.id}`);
          return { target: t, already, row: r };
        });
        return { leagueId: lg.leagueId, leagueName: lg.leagueName, cells };
      })
      .filter((l) => l.cells.some((c) => c.row || c.already));
  }, [targets, rosteredEff, rows, planLeagues]);

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

  // Find a specific row in a long batch (a player across 50+ leagues, or
  // several targets at once) instead of scrolling to it. Filters the VIEW
  // only — Select all/none below act on whatever's currently filtered in,
  // real selection state for everything else is untouched.
  // "Empty spot, no waivers queued": only leagues where this add needs no drop AND you have no pending claim there yet.
  // Needs the claims scan (Waiver Assistant passes claimsByLeague); hidden where it isn't available.
  const [noClaimsOnly, setNoClaimsOnly] = useState(false);
  const visibleRows = useMemo(() => {
    const q = rowFilter.trim().toLowerCase();
    let out = rows;
    if (noClaimsOnly && claimsByLeague) out = out.filter((r) => !r.full && (claimsByLeague.get(r.leagueId)?.length ?? 0) === 0);
    if (!q) return out;
    return out.filter((r) => r.leagueName.toLowerCase().includes(q) || nameOf(pmap, r.targetId).toLowerCase().includes(q));
  }, [rows, rowFilter, pmap, noClaimsOnly, claimsByLeague]);

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

  // Set the same bid across every FAAB row in one click instead of editing
  // each one by hand — real per-row budget caps (bidFor's own min/budgetLeft
  // clamp) still apply when the row renders, so this can never push a bid
  // over what a specific league can actually support.
  const applyBulkBid = () => {
    if (bulkBid === "" || bulkBid < 0) return;
    setBidOverride((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (r.faab && !finished(r)) next[r.key] = bulkBid;
      }
      return next;
    });
  };

  const start = async () => {
    if (!token) return;
    setConfirming(false);
    setRunning(true);
    setSummary("");
    abortRef.current = { aborted: false };

    // Pre-flight: before anything is sent, re-read every affected league from Sleeper and set aside any whose roster changed
    // since this plan was built, and any league where the player has since been taken by another team. The same read gives
    // us everyone's roster, so "is he still free?" is checked against right now. One check per league.
    setSummary("Checking every roster against Sleeper first…");
    const pre = await preflightRosters(
      selectedRows.map((r) => {
        const lg = planLeagues.find((l) => l.leagueId === r.leagueId);
        return {
          leagueId: r.leagueId,
          rosterId: r.rosterId,
          base: lg ? { starters: lg.starters, players: lg.players, reserve: lg.reserve } : null,
          strictStarters: false,
        };
      })
    );
    setSummary("");

    const tasks: BulkTask[] = selectedRows.map((r) => ({
      key: r.key,
      run: async () => {
        const blocked = pre[r.leagueId]?.blocked;
        if (blocked) throw new Error(blocked);
        if (pre[r.leagueId]?.fresh?.allRostered?.includes(r.targetId)) {
          throw new Error(`${nameOf(pmap, r.targetId)} was added by another team in this league since this page loaded — nothing was sent. Reload and review.`);
        }
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
    const tone = bulkResultTone(result);
    setSummaryColor(tone.color);
    setSummary(
      `${tone.prefix}${result.done} succeeded${result.failed ? `, ${result.failed} failed` : ""}${
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
                <input
                  className="input"
                  placeholder="Find a league or player…"
                  value={rowFilter}
                  onChange={(e) => setRowFilter(e.target.value)}
                  style={{ maxWidth: 220 }}
                />
                {claimsByLeague && (
                  <button
                    className={`chip-filter ${noClaimsOnly ? "on" : ""}`}
                    onClick={() => setNoClaimsOnly((v) => !v)}
                    title="Only leagues where this add needs no drop and you have no waiver claim queued yet"
                  >
                    Empty spot, no waivers queued
                  </button>
                )}
                <button className="chip-filter" onClick={selectVisible}>Select all{rowFilter || noClaimsOnly ? " shown" : ""}</button>
                <button className="chip-filter" onClick={deselectVisible}>Select none{rowFilter || noClaimsOnly ? " shown" : ""}</button>
                {rows.some((r) => r.faab) && (
                  <>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      placeholder="Bid $"
                      value={bulkBid}
                      onChange={(e) => setBulkBid(e.target.value === "" ? "" : Number(e.target.value))}
                      style={{ width: 70 }}
                      title="Set this bid on every FAAB row below (still capped per league)"
                    />
                    <button className="chip-filter" disabled={bulkBid === ""} onClick={applyBulkBid}>Set all bids</button>
                  </>
                )}
                <span style={{ flex: 1 }} />
                {running ? (
                  <button className="btn ghost" onClick={() => (abortRef.current.aborted = true)}>Abort</button>
                ) : (
                  <button className="btn" disabled={!token || selectedRows.length === 0 || confirming} onClick={() => setConfirming(true)}>
                    Add {selectedRows.length} across {new Set(selectedRows.map((r) => r.leagueId)).size} leagues
                  </button>
                )}
              </div>
              {rowFilter && <p className="hint" style={{ margin: "0 0 8px" }}>{visibleRows.length} of {rows.length} rows match &ldquo;{rowFilter}&rdquo;</p>}
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
              {summary && <p className="hint" style={{ color: summaryColor, fontWeight: 600 }}>{summary}</p>}

              <div className="mgrtable-scroll">
                <DataTable>
                  <TableHeaderRow>
                    <span style={{ width: 22 }} />
                    <span style={{ minWidth: 130 }}>Player</span>
                    <span style={{ flex: 1 }}>League</span>
                    <span style={{ minWidth: 200 }}>Roster</span>
                    <span style={{ minWidth: 70 }}>Bid</span>
                    <span style={{ minWidth: 90 }}>Result</span>
                  </TableHeaderRow>
                  {visibleRows.map((r) => (
                    <TableRow key={r.key} style={finished(r) ? { opacity: 0.6 } : undefined}>
                      <input
                        type="checkbox"
                        checked={!deselected.has(r.key) && runnable(r)}
                        disabled={!runnable(r) || running}
                        onChange={() => toggle(r.key)}
                      />
                      <span className="tname" style={{ minWidth: 130 }}>{nameOf(pmap, r.targetId)}</span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <div className="tname">{r.leagueName}</div>
                        {(() => {
                          const cl = claimsByLeague?.get(r.leagueId);
                          if (!cl || cl.length === 0) return null;
                          return (
                            <div className="portmeta" style={{ fontSize: 11, color: "var(--amber)", marginTop: 2 }}>
                              {cl
                                .map((c) => {
                                  const add = c.addId ? nameOf(pmap, c.addId) : "?";
                                  const drop = c.dropId ? nameOf(pmap, c.dropId) : null;
                                  return `${add}${drop ? ` (drop ${drop})` : ""}${c.bid != null ? ` $${c.bid}` : ""}`;
                                })
                                .join(", ")}{" "}
                              pending
                            </div>
                          );
                        })()}
                      </span>
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
                      <span style={{ minWidth: 70, display: "flex", flexDirection: "column", gap: 2 }}>
                        {r.faab ? (
                          <>
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
                            {r.budgetLeft != null && (
                              <span
                                className="portmeta"
                                style={{ fontSize: 11, color: r.budgetLeft < r.bidMin ? "var(--red)" : undefined }}
                              >
                                ${r.budgetLeft} left
                              </span>
                            )}
                          </>
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
