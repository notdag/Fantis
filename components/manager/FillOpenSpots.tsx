"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTrendingAdds, getTrendingDrops } from "@/lib/sleeper";
import { fetchAllLive, preflightRosters, type LiveRoster } from "@/lib/liveRosters";
import { addDropFreeAgent, claimWaiver } from "@/lib/sleeperWrite";
import { runBulk, bulkResultTone, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { suggestBid, type FaabStats } from "@/lib/faabHistory";
import { posChipStyle } from "@/lib/players";
import type { PlayerMap } from "@/lib/types";
import type { LineupLeague } from "./LineupManager";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useRefreshLeagues } from "./useRefreshLeagues";

const OFFENSE = new Set(["QB", "RB", "WR", "TE"]);

const inner = (settings: unknown, key: string): number => {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>).settings : null;
  const v = s && typeof s === "object" ? (s as Record<string, unknown>)[key] : null;
  return typeof v === "number" ? v : 0;
};

interface Row {
  league: LineupLeague;
  spots: number;
  live: LiveRoster | null;
}

// Every league with open roster spots, how many, and a picker per spot: Sleeper's most-added players right now that are
// actually still free in THAT league (read live), or anyone you search. Adds need no drop; a player still on waivers becomes a
// claim (FAAB bid suggested from the league's own past claims). Nothing is sent until you confirm.
export default function FillOpenSpots({ leagues, pmap, token }: { leagues: LineupLeague[]; pmap: PlayerMap | null; token: string | null }) {
  const refresh = useRefreshLeagues();
  const [live, setLive] = useState<Record<string, LiveRoster>>({});
  const [liveLoading, setLiveLoading] = useState(true);
  const [trending, setTrending] = useState<{ id: string; count: number }[]>([]);
  const [dropped, setDropped] = useState<{ id: string; count: number }[]>([]);
  // Where the picker's choices come from. "best" = Sleeper's own popularity rank (search_rank) — the closest public signal to
  // "most rostered" (Sleeper doesn't publish roster %); "handcuffs" = RB2s on Sleeper's depth chart, your own starters' backups first.
  const [source, setSource] = useState<"adds" | "drops" | "best" | "handcuffs">("adds");
  const [faabStats, setFaabStats] = useState<FaabStats | null>(null);
  const [only, setOnly] = useState<0 | 1 | 2 | 3>(0); // 0 = all, 3 = 3+
  const [picks, setPicks] = useState<Record<string, string[]>>({}); // leagueId -> player ids, one per spot
  const [bids, setBids] = useState<Record<string, number>>({}); // "leagueId:playerId" -> bid
  const [search, setSearch] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryColor, setSummaryColor] = useState<string | undefined>(undefined);
  const abortRef = useRef({ aborted: false });

  const candidates = useMemo(() => leagues.filter((l) => l.roster && l.rosterPositions.length > 0), [leagues]);
  const targetsKey = candidates.map((l) => l.league.id).join(",");
  useEffect(() => {
    let alive = true;
    fetchAllLive(candidates.map((l) => ({ leagueId: l.league.id, rosterId: l.roster!.rosterId })))
      .then((r) => alive && setLive(r.live))
      .finally(() => alive && setLiveLoading(false));
    getTrendingAdds(24, 60)
      .then((t) => alive && setTrending(t.map((x) => ({ id: x.player_id, count: x.count }))))
      .catch(() => {});
    getTrendingDrops(24, 60)
      .then((t) => alive && setDropped(t.map((x) => ({ id: x.player_id, count: x.count }))))
      .catch(() => {});
    fetch("/api/manager/faab-suggest")
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { stats?: FaabStats } | null) => alive && setFaabStats(b?.stats ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey]);

  // Open spots from the LIVE roster when we have it (the stored sync can be stale), else from the stored one.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const l of candidates) {
      const lv = live[l.league.id] ?? null;
      const players = lv?.players ?? l.roster!.players;
      const reserve = lv?.reserve ?? l.roster!.reserve;
      const spots = l.rosterPositions.length - (players.length - reserve.length);
      if (spots > 0) out.push({ league: l, spots, live: lv });
    }
    return out.sort((a, b) => b.spots - a.spots || a.league.league.name.localeCompare(b.league.league.name));
  }, [candidates, live]);
  const shown = rows.filter((r) => only === 0 || (only === 3 ? r.spots >= 3 : r.spots === only));
  const count = (n: 1 | 2 | 3) => rows.filter((r) => (n === 3 ? r.spots >= 3 : r.spots === n)).length;

  const takenIn = (r: Row) => new Set(r.live?.allRostered ?? []);
  // Sleeper ranks for everyone on a team, best first — reused by "best available" and "handcuffs".
  const ranked = useMemo(() => {
    if (!pmap) return [] as string[];
    return Object.entries(pmap)
      .filter(([, e]) => OFFENSE.has(e.p) && !!e.t && e.rk != null)
      .sort((a, b) => (a[1].rk ?? 1e9) - (b[1].rk ?? 1e9))
      .map(([id]) => id);
  }, [pmap]);
  // Each team's RB1 on Sleeper's depth chart, so a handcuff can say whose backup he is.
  const rb1ByTeam = useMemo(() => {
    const m = new Map<string, string>();
    if (!pmap) return m;
    for (const [id, e] of Object.entries(pmap)) if (e.p === "RB" && e.t && e.dc === 1 && !m.has(e.t)) m.set(e.t, id);
    return m;
  }, [pmap]);
  const available = (r: Row): { id: string; count: number; note?: string }[] => {
    const taken = takenIn(r);
    const free = (id: string) => OFFENSE.has(pmap?.[id]?.p ?? "") && !!pmap?.[id]?.t && !taken.has(id);
    if (source === "adds") return trending.filter((t) => free(t.id)).slice(0, 30);
    if (source === "drops") return dropped.filter((t) => free(t.id)).slice(0, 30).map((t) => ({ ...t, note: `dropped in ${t.count.toLocaleString()} leagues (24h)` }));
    if (source === "best") return ranked.filter(free).slice(0, 30).map((id) => ({ id, count: 0, note: `Sleeper rank #${pmap?.[id]?.rk}` }));
    // handcuffs: free RBs listed 2nd (or 3rd) on their team's depth chart; your own RB1s' backups first.
    const mine = new Set(r.live?.players ?? r.league.roster?.players ?? []);
    return ranked
      .filter((id) => free(id) && pmap?.[id]?.p === "RB" && (pmap?.[id]?.dc === 2 || pmap?.[id]?.dc === 3))
      .map((id) => {
        const starter = rb1ByTeam.get(pmap![id].t);
        const own = !!starter && mine.has(starter);
        return { id, count: 0, own, note: starter ? `${own ? "YOUR " : ""}handcuff for ${pmap?.[starter]?.n ?? starter}` : "RB2" };
      })
      .sort((a, b) => Number(b.own) - Number(a.own))
      .slice(0, 30)
      .map(({ id, count, note }) => ({ id, count, note }));
  };
  const pickList = (r: Row) => picks[r.league.league.id] ?? [];
  const setPick = (r: Row, i: number, id: string) =>
    setPicks((p) => {
      const cur = [...(p[r.league.league.id] ?? Array(r.spots).fill(""))];
      cur[i] = id;
      return { ...p, [r.league.league.id]: cur };
    });
  const autoFill = () => {
    const next: Record<string, string[]> = { ...picks };
    for (const r of shown) {
      if (!r.live) continue; // without a live read we can't tell who's still free there
      next[r.league.league.id] = available(r).slice(0, r.spots).map((t) => t.id);
    }
    setPicks(next);
  };
  const searchMatches = (r: Row) => {
    const q = (search[r.league.league.id] ?? "").trim().toLowerCase();
    if (q.length < 2 || !pmap) return [];
    const taken = takenIn(r);
    const out: string[] = [];
    for (const [id, e] of Object.entries(pmap)) {
      if (out.length >= 6) break;
      if (!OFFENSE.has(e.p) || !e.t || taken.has(id) || !e.n.toLowerCase().includes(q)) continue;
      out.push(id);
    }
    return out;
  };

  const isFaab = (l: LineupLeague) => inner(l.league.settings, "waiver_type") === 2;
  const bidMin = (l: LineupLeague) => inner(l.league.settings, "waiver_bid_min");
  const budgetLeft = (l: LineupLeague) => {
    const b = inner(l.league.settings, "waiver_budget");
    return isFaab(l) && b > 0 ? Math.max(0, b - (l.roster?.faabUsed ?? 0)) : null;
  };
  const bidFor = (l: LineupLeague, id: string) => {
    const k = `${l.league.id}:${id}`;
    const raw = k in bids ? bids[k] : suggestBid(faabStats, l.league.id, pmap?.[id]?.p ?? "", bidMin(l), bidMin(l)).bid;
    const left = budgetLeft(l);
    return Math.max(bidMin(l), Math.min(raw, left ?? raw));
  };

  const queue = rows.flatMap((r) =>
    pickList(r)
      .filter((id, i, arr) => !!id && arr.indexOf(id) === i)
      .slice(0, r.spots)
      .map((id) => ({ key: `${r.league.league.id}:${id}`, row: r, id }))
  );
  const pending = queue.filter((q) => status[q.key]?.kind !== "done");
  const nameOf = (id: string) => pmap?.[id]?.n ?? id;

  const start = async () => {
    if (!token) return;
    setConfirming(false);
    setRunning(true);
    setSummary("Checking every roster against Sleeper first…");
    setSummaryColor(undefined);
    abortRef.current = { aborted: false };
    const batch = [...pending];
    const pre = await preflightRosters(
      batch.map((q) => ({
        leagueId: q.row.league.league.id,
        rosterId: q.row.league.roster!.rosterId,
        base: q.row.live ? { starters: q.row.live.starters, players: q.row.live.players, reserve: q.row.live.reserve } : null,
        strictStarters: false,
      }))
    );
    setSummary("");
    const tasks: BulkTask[] = batch.map((q) => ({
      key: q.key,
      run: async () => {
        const l = q.row.league;
        const p = pre[l.league.id];
        if (p?.blocked) throw new Error(p.blocked);
        if (p?.fresh?.allRostered?.includes(q.id)) throw new Error(`${nameOf(q.id)} was just taken in this league — nothing sent.`);
        const base = { leagueId: l.league.id, rosterId: l.roster!.rosterId, addPlayerId: q.id };
        try {
          await addDropFreeAgent(token, base);
          return "added";
        } catch (e) {
          if (e instanceof Error && /waiver/i.test(e.message)) {
            const bid = isFaab(l) ? bidFor(l, q.id) : 0;
            await claimWaiver(token, { ...base, bid });
            return isFaab(l) ? `claim placed ($${bid})` : "claim placed";
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
    const refreshed = result.done > 0 ? await refresh([...new Set(doneKeys.map((k) => k.split(":")[0]))]) : null;
    const tone = bulkResultTone(result);
    setSummaryColor(tone.color);
    setSummary(
      `${tone.prefix}${result.done} added or claimed${result.failed ? `, ${result.failed} failed` : ""}${result.skipped ? `, ${result.skipped} skipped` : ""}.` +
        (result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : "") +
        (refreshed === null ? "" : refreshed ? " Fantis's data was refreshed for those leagues." : "")
    );
  };

  return (
    <>
      <div className="field" style={{ alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <button className={`chip-filter ${only === 0 ? "on" : ""}`} onClick={() => setOnly(0)}>All ({rows.length})</button>
        <button className={`chip-filter ${only === 1 ? "on" : ""}`} onClick={() => setOnly(1)}>1 open ({count(1)})</button>
        <button className={`chip-filter ${only === 2 ? "on" : ""}`} onClick={() => setOnly(2)}>2 open ({count(2)})</button>
        <button className={`chip-filter ${only === 3 ? "on" : ""}`} onClick={() => setOnly(3)}>3+ open ({count(3)})</button>
        <span className="portmeta" style={{ marginLeft: 8 }}>Choices:</span>
        {(
          [
            ["adds", "Most added (24h)"],
            ["drops", "Recently dropped"],
            ["best", "Best available (Sleeper rank)"],
            ["handcuffs", "RB handcuffs"],
          ] as const
        ).map(([k, lbl]) => (
          <button key={k} className={`chip-filter ${source === k ? "on" : ""}`} onClick={() => setSource(k)}>
            {lbl}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="chip-filter" disabled={running || liveLoading} onClick={autoFill} title="Fill every shown league's open spots with the top choices still free there (current Choices list)">
          Fill shown with top choices
        </button>
        {running ? (
          <button className="btn ghost" onClick={() => (abortRef.current.aborted = true)}>Abort</button>
        ) : (
          <button className="btn" disabled={!token || pending.length === 0} onClick={() => setConfirming(true)}>
            Add {pending.length} player{pending.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      <p className="hint" style={{ margin: "0 0 10px" }}>
        {liveLoading ? "Reading rosters live from Sleeper…" : "Open spots and who's still free are read live from Sleeper."} Choices (pick a list above): Sleeper&rsquo;s most-added or
        most-dropped players in the last 24h, the best available by Sleeper&rsquo;s own rank (their popularity rank — Sleeper doesn&rsquo;t publish roster %),
        or RB handcuffs from Sleeper&rsquo;s depth chart (your own starters&rsquo; backups first) — always only players still free in that league. Or search anyone. No drop is needed; a player on waivers becomes a claim.
      </p>
      {!token && <p className="hint" style={{ color: "var(--red)" }}>Connect write access above to send.</p>}
      {confirming && (
        <BulkConfirm
          title={`Add ${pending.length} player${pending.length === 1 ? "" : "s"} across ${new Set(pending.map((q) => q.row.league.league.id)).size} leagues (no drops)`}
          lines={pending.map((q) => (
            <span key={q.key}>
              {q.row.league.league.name}: add {nameOf(q.id)}
              {isFaab(q.row.league) ? ` (bid $${bidFor(q.row.league, q.id)} if on waivers)` : ""}
            </span>
          ))}
          confirmLabel={`Send ${pending.length}`}
          onConfirm={start}
          onCancel={() => setConfirming(false)}
        />
      )}
      {summary && <p className="hint" style={{ color: summaryColor ?? "var(--bone)", fontWeight: summaryColor ? 650 : undefined }}>{summary}</p>}

      {shown.length === 0 ? (
        <p className="hint">{rows.length === 0 ? "Every roster is full right now — nothing to add without a drop." : "No leagues match this filter."}</p>
      ) : (
        <div className="mgrtable-scroll">
          <DataTable>
            <TableHeaderRow>
              <span style={{ flex: "0 0 220px" }}>League</span>
              <span style={{ flex: 1 }}>Who to add (one per open spot)</span>
            </TableHeaderRow>
            {shown.map((r) => {
              const l = r.league;
              const opts = available(r);
              const list = pickList(r);
              const matches = searchMatches(r);
              return (
                <TableRow key={l.league.id}>
                  <span style={{ flex: "0 0 220px", minWidth: 0 }}>
                    <Link href={`/manager/${l.league.id}`} className="tname">{l.league.name}</Link>
                    <span className="portmeta" style={{ display: "block", color: "var(--mint)", fontWeight: 600 }}>
                      {r.spots} open{!r.live ? " · couldn't read live" : ""}
                      {budgetLeft(l) != null ? ` · $${budgetLeft(l)} FAAB left` : ""}
                    </span>
                  </span>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    {Array.from({ length: r.spots }, (_, i) => {
                      const id = list[i] ?? "";
                      const k = `${l.league.id}:${id}`;
                      const extra = id && !opts.some((o) => o.id === id) ? [{ id, count: 0 }] : [];
                      return (
                        <span key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <select className="select sm" value={id} disabled={running} onChange={(e) => setPick(r, i, e.target.value)} style={{ minWidth: 260 }}>
                            <option value="">— spot {i + 1}: leave open —</option>
                            {([...extra, ...opts] as { id: string; count: number; note?: string }[]).map((o) => (
                              <option key={o.id} value={o.id} disabled={o.id !== id && list.includes(o.id)}>
                                {nameOf(o.id)} · {pmap?.[o.id]?.p} {pmap?.[o.id]?.t}
                                {o.note ? ` · ${o.note}` : o.count ? ` · +${o.count.toLocaleString()} adds` : ""}
                                {pmap?.[o.id]?.inj ? ` (${pmap[o.id].inj})` : ""}
                              </option>
                            ))}
                          </select>
                          {id && pmap?.[id]?.p && <span className="pos" style={posChipStyle(pmap[id].p)}>{pmap[id].p}</span>}
                          {id && isFaab(l) && (
                            <label className="portmeta" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              bid $
                              <input
                                className="input"
                                type="number"
                                min={bidMin(l)}
                                max={budgetLeft(l) ?? undefined}
                                value={bidFor(l, id)}
                                disabled={running}
                                onChange={(e) => setBids((b) => ({ ...b, [k]: Number(e.target.value) || 0 }))}
                                style={{ width: 64 }}
                              />
                            </label>
                          )}
                          {id && <StatusCell status={status[k]} />}
                        </span>
                      );
                    })}
                    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        className="input"
                        style={{ maxWidth: 220 }}
                        placeholder="Search anyone free here…"
                        value={search[l.league.id] ?? ""}
                        disabled={running}
                        onChange={(e) => setSearch((s) => ({ ...s, [l.league.id]: e.target.value }))}
                      />
                      {matches.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className="chip-filter"
                          onClick={() => {
                            const free = Array.from({ length: r.spots }, (_, i) => list[i] ?? "").findIndex((x) => !x);
                            setPick(r, free < 0 ? r.spots - 1 : free, id);
                            setSearch((s) => ({ ...s, [l.league.id]: "" }));
                          }}
                        >
                          + {nameOf(id)} · {pmap?.[id]?.p} {pmap?.[id]?.t}
                        </button>
                      ))}
                    </span>
                  </span>
                </TableRow>
              );
            })}
          </DataTable>
        </div>
      )}
    </>
  );
}
