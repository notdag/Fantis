"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTrendingAdds, getTrendingDrops } from "@/lib/sleeper";
import { fetchAllLive, preflightRosters, type LiveRoster } from "@/lib/liveRosters";
import { addDropFreeAgent, claimWaiver } from "@/lib/sleeperWrite";
import { runBulk, bulkResultTone, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { suggestBid, type FaabStats } from "@/lib/faabHistory";
import { buildStartingSlots, eligiblePositions } from "@/lib/rosterSlots";
import { posChipStyle } from "@/lib/players";
import type { PlayerMap } from "@/lib/types";
import type { LineupLeague } from "./LineupManager";
import { PlayerAvatar } from "./Avatar";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useRefreshLeagues } from "./useRefreshLeagues";

const OFFENSE = new Set(["QB", "RB", "WR", "TE"]);
const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
// Statuses that mean "won't play" — the same set the lineup tools treat as unavailable.
const OUT = new Set(["Out", "IR", "PUP", "Sus", "COV", "NA", "DNR", "Doubtful"]);
const INJ_SHORT: Record<string, string> = { Questionable: "Q", Doubtful: "D", Out: "O", IR: "IR", PUP: "PUP", Sus: "SUS", COV: "COV" };

const inner = (settings: unknown, key: string): number => {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>).settings : null;
  const v = s && typeof s === "object" ? (s as Record<string, unknown>)[key] : null;
  return typeof v === "number" ? v : 0;
};

type Source = "adds" | "drops" | "best" | "handcuffs";
interface Row {
  league: LineupLeague;
  spots: number;
  live: LiveRoster | null;
  players: string[];
  reserve: string[];
  starters: string[];
}
interface Need {
  pos: string;
  healthy: number;
  slots: number;
  short: boolean; // fewer healthy players than starting slots
}
interface Suggestion {
  id: string;
  count: number;
  note?: string;
}

// Every league with open roster spots, shown as one block per league: your roster by position (starters, injuries), what you're
// short at, the claims you've lined up, and suggestion cards to tap. Choices come from Sleeper's live lists and are always players
// still free in THAT league. Open spots need no drop; extra claims can stack on the same spot (drop optional). Nothing is sent
// until you confirm.
export default function FillOpenSpots({
  leagues,
  pmap,
  token,
  onSent,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  onSent?: () => void;
}) {
  const refresh = useRefreshLeagues();
  const [live, setLive] = useState<Record<string, LiveRoster>>({});
  const [liveLoading, setLiveLoading] = useState(true);
  const [trending, setTrending] = useState<Suggestion[]>([]);
  const [dropped, setDropped] = useState<Suggestion[]>([]);
  // "best" = Sleeper's own popularity rank (search_rank) — the closest public signal to "most rostered" (Sleeper doesn't publish
  // roster %); "handcuffs" = RB2s on Sleeper's depth chart, your own starters' backups first.
  const [source, setSource] = useState<Source>("adds");
  const [faabStats, setFaabStats] = useState<FaabStats | null>(null);
  const [only, setOnly] = useState<0 | 1 | 2 | 3>(0); // 0 = all, 3 = 3+
  const [picks, setPicks] = useState<Record<string, string[]>>({}); // leagueId -> claim order (player ids)
  const [dropPick, setDropPick] = useState<Record<string, string>>({}); // "leagueId:playerId" -> player to drop (extra claims only)
  const [bids, setBids] = useState<Record<string, number>>({}); // "leagueId:playerId" -> bid
  const [search, setSearch] = useState<Record<string, string>>({});
  const [more, setMore] = useState<Set<string>>(new Set());
  // Multi-league view: leagues collapse to a one-line summary once there are more than a few; open any to edit.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [needFilter, setNeedFilter] = useState<string | null>(null); // "RB" etc — only leagues short/thin there
  const [flash, setFlash] = useState("");
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
      const starters = lv?.starters ?? l.roster!.starters;
      const spots = l.rosterPositions.length - (players.length - reserve.length);
      if (spots > 0) out.push({ league: l, spots, live: lv, players, reserve, starters });
    }
    return out.sort((a, b) => b.spots - a.spots || a.league.league.name.localeCompare(b.league.league.name));
  }, [candidates, live]);
  const shownBySpots = rows.filter((r) => only === 0 || (only === 3 ? r.spots >= 3 : r.spots === only));
  const count = (n: 1 | 2 | 3) => rows.filter((r) => (n === 3 ? r.spots >= 3 : r.spots === n)).length;

  // Sleeper ranks for everyone on a team, best first — reused by "best available" and "handcuffs".
  const ranked = useMemo(() => {
    if (!pmap) return [] as string[];
    return Object.entries(pmap)
      .filter(([, e]) => OFFENSE.has(e.p) && !!e.t && e.rk != null)
      .sort((a, b) => (a[1].rk ?? 1e9) - (b[1].rk ?? 1e9))
      .map(([id]) => id);
  }, [pmap]);
  const rb1ByTeam = useMemo(() => {
    const m = new Map<string, string>();
    if (!pmap) return m;
    for (const [id, e] of Object.entries(pmap)) if (e.p === "RB" && e.t && e.dc === 1 && !m.has(e.t)) m.set(e.t, id);
    return m;
  }, [pmap]);

  const nameOf = (id: string) => pmap?.[id]?.n ?? id;
  const posOf = (id: string) => pmap?.[id]?.p ?? "";
  const isOut = (id: string) => OUT.has(pmap?.[id]?.inj ?? "");

  // What you're short at: healthy players per position vs the starting slots that position can fill (FLEX shares RB/WR/TE,
  // SUPER_FLEX adds QB). "short" = fewer healthy than slots; otherwise "no backup" when healthy just equals the slots.
  const needsOf = (r: Row): Need[] => {
    const codes = buildStartingSlots(r.league.rosterPositions).map((s) => s.code);
    const active = r.players.filter((id) => !r.reserve.includes(id));
    const out: Need[] = [];
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const slots = codes.filter((c) => c === pos).length;
      if (slots === 0) continue;
      const healthy = active.filter((id) => posOf(id) === pos && !isOut(id)).length;
      if (healthy <= slots) out.push({ pos, healthy, slots, short: healthy < slots });
    }
    const flex = codes.filter((c) => c !== "QB" && c !== "RB" && c !== "WR" && c !== "TE" && eligiblePositions(c).some((p) => p === "RB" || p === "WR")).length;
    if (flex > 0) {
      const fixed = ["RB", "WR", "TE"].reduce((n, p) => n + codes.filter((c) => c === p).length, 0);
      const healthyFlex = active.filter((id) => ["RB", "WR", "TE"].includes(posOf(id)) && !isOut(id)).length;
      if (healthyFlex < fixed + flex) out.push({ pos: "FLEX", healthy: healthyFlex - fixed, slots: flex, short: true });
    }
    return out.sort((a, b) => Number(b.short) - Number(a.short));
  };

  const takenIn = (r: Row) => new Set(r.live?.allRostered ?? []);
  const suggestionsFor = (r: Row): Suggestion[] => {
    const taken = takenIn(r);
    const free = (id: string) => OFFENSE.has(posOf(id)) && !!pmap?.[id]?.t && !taken.has(id) && !r.players.includes(id);
    let list: Suggestion[];
    if (source === "adds") list = trending.filter((t) => free(t.id)).map((t) => ({ ...t, note: `+${t.count.toLocaleString()} adds` }));
    else if (source === "drops") list = dropped.filter((t) => free(t.id)).map((t) => ({ ...t, note: `dropped ${t.count.toLocaleString()}×` }));
    else if (source === "best") list = ranked.filter(free).slice(0, 60).map((id) => ({ id, count: 0, note: `Sleeper #${pmap?.[id]?.rk}` }));
    else {
      list = ranked
        .filter((id) => free(id) && posOf(id) === "RB" && (pmap?.[id]?.dc === 2 || pmap?.[id]?.dc === 3))
        .map((id) => {
          const starter = rb1ByTeam.get(pmap![id].t);
          const own = !!starter && r.players.includes(starter);
          return { id, count: own ? 1 : 0, note: starter ? `${own ? "YOUR " : ""}cuff · ${(pmap?.[starter]?.n ?? "").split(" ").slice(-1)[0]}` : "RB2" };
        })
        .sort((a, b) => b.count - a.count);
    }
    // Positions you're short at come first; otherwise keep the list's own order.
    const needPos = new Set(needsOf(r).flatMap((n) => (n.pos === "FLEX" ? ["RB", "WR", "TE"] : [n.pos])));
    return [...list].sort((a, b) => Number(needPos.has(posOf(b.id))) - Number(needPos.has(posOf(a.id))));
  };

  const pickList = (r: Row) => picks[r.league.league.id] ?? [];
  const addPick = (r: Row, id: string) =>
    setPicks((p) => {
      const cur = p[r.league.league.id] ?? [];
      return cur.includes(id) ? p : { ...p, [r.league.league.id]: [...cur, id] };
    });
  const removePick = (r: Row, id: string) => setPicks((p) => ({ ...p, [r.league.league.id]: (p[r.league.league.id] ?? []).filter((x) => x !== id) }));
  const movePick = (r: Row, id: string, dir: -1 | 1) =>
    setPicks((p) => {
      const cur = [...(p[r.league.league.id] ?? [])];
      const i = cur.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= cur.length) return p;
      [cur[i], cur[j]] = [cur[j], cur[i]];
      return { ...p, [r.league.league.id]: cur };
    });
  const autoFill = () => {
    const next = { ...picks };
    for (const r of shown) {
      if (!r.live) continue; // without a live read we can't tell who's still free there
      const cur = (next[r.league.league.id] ?? []).slice(0, r.spots);
      for (const s of suggestionsFor(r)) {
        if (cur.length >= r.spots) break;
        if (!cur.includes(s.id)) cur.push(s.id);
      }
      next[r.league.league.id] = cur;
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
      if (!OFFENSE.has(e.p) || !e.t || taken.has(id) || r.players.includes(id) || !e.n.toLowerCase().includes(q)) continue;
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
    const raw = k in bids ? bids[k] : suggestBid(faabStats, l.league.id, posOf(id), bidMin(l), bidMin(l)).bid;
    const left = budgetLeft(l);
    return Math.max(bidMin(l), Math.min(raw, left ?? raw));
  };
  const dropOptions = (r: Row) =>
    r.players.filter((id) => !r.reserve.includes(id)).sort((a, b) => (pmap?.[b]?.rk ?? 1e9) - (pmap?.[a]?.rk ?? 1e9));

  const queue = rows.flatMap((r) =>
    pickList(r).map((id, i) => {
      const lid = r.league.league.id;
      return { key: `${lid}:${id}`, row: r, id, drop: i >= r.spots ? dropPick[`${lid}:${id}`] || undefined : undefined };
    })
  );
  const pending = queue.filter((q) => status[q.key]?.kind !== "done");
  const extraNoDrop = queue.filter((q) => pickList(q.row).indexOf(q.id) >= q.row.spots && !q.drop).length;

  // ---- multi-league helpers
  const needsByLeague = new Map(shownBySpots.map((r) => [r.league.league.id, needsOf(r)]));
  const needCounts = ["QB", "RB", "WR", "TE"].map((p) => [p, shownBySpots.filter((r) => (needsByLeague.get(r.league.league.id) ?? []).some((n) => n.pos === p || (n.pos === "FLEX" && p !== "QB"))).length] as const);
  const shown = needFilter
    ? shownBySpots.filter((r) => (needsByLeague.get(r.league.league.id) ?? []).some((n) => n.pos === needFilter || (n.pos === "FLEX" && needFilter !== "QB")))
    : shownBySpots;
  const isOpen = (lid: string) => openMap[lid] ?? shown.length <= 3;
  const setAllOpen = (on: boolean) => setOpenMap(Object.fromEntries(shown.map((r) => [r.league.league.id, on])));
  const unfilled = shown.filter((r) => pickList(r).length < r.spots);
  const queuedLeagues = new Set(queue.map((q) => q.row.league.league.id)).size;
  // Players that are free in several of the shown leagues — one tap queues him wherever he's free and you still have an empty spot.
  const across = (() => {
    const agg = new Map<string, { s: Suggestion; leagues: Row[] }>();
    for (const r of shown) {
      if (!r.live) continue;
      for (const s of suggestionsFor(r).slice(0, 30)) {
        const a = agg.get(s.id) ?? { s, leagues: [] };
        a.leagues.push(r);
        agg.set(s.id, a);
      }
    }
    return [...agg.values()].filter((a) => a.leagues.length >= 2).sort((a, b) => b.leagues.length - a.leagues.length).slice(0, 12);
  })();
  const queueEverywhere = (id: string, leaguesFree: Row[]) => {
    let n = 0;
    const next = { ...picks };
    for (const r of leaguesFree) {
      const cur = next[r.league.league.id] ?? [];
      if (cur.includes(id) || cur.length >= r.spots) continue; // only into a still-empty spot — never an extra claim
      next[r.league.league.id] = [...cur, id];
      n++;
    }
    setPicks(next);
    setFlash(n ? `Queued ${nameOf(id)} in ${n} league${n === 1 ? "" : "s"} with an empty spot.` : `${nameOf(id)} — no league with an empty spot left to put him in.`);
  };
  const nextUnfilled = () => {
    const r = unfilled[0];
    if (!r) return;
    const lid = r.league.league.id;
    setOpenMap((m) => ({ ...m, [lid]: true }));
    requestAnimationFrame(() => document.getElementById(`fos-${lid}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

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
        if (q.drop && p?.fresh && !p.fresh.players.includes(q.drop)) throw new Error(`${nameOf(q.drop)} is no longer on this roster — nothing sent.`);
        const base = { leagueId: l.league.id, rosterId: l.roster!.rosterId, addPlayerId: q.id, ...(q.drop ? { dropPlayerId: q.drop } : {}) };
        try {
          await addDropFreeAgent(token, base);
          return q.drop ? `added (dropped ${nameOf(q.drop)})` : "added";
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
    // One at a time: several claims in the same league must reach Sleeper in the order shown (that's your claim priority).
    const result = await runBulk(tasks, {
      concurrency: 1,
      signal: abortRef.current,
      onStatus: (key, s) => {
        if (s.kind === "done") doneKeys.push(key);
        setStatus((prev) => ({ ...prev, [key]: s }));
      },
    });
    setRunning(false);
    if (result.done > 0) onSent?.();
    const refreshed = result.done > 0 ? await refresh([...new Set(doneKeys.map((k) => k.split(":")[0]))]) : null;
    const tone = bulkResultTone(result);
    setSummaryColor(tone.color);
    setSummary(
      `${tone.prefix}${result.done} added or claimed${result.failed ? `, ${result.failed} failed` : ""}${result.skipped ? `, ${result.skipped} skipped` : ""}.` +
        (result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : "") +
        (refreshed === null ? "" : refreshed ? " Fantis's data was refreshed for those leagues." : "")
    );
  };

  const SOURCES: [Source, string][] = [
    ["adds", "Most added"],
    ["drops", "Recently dropped"],
    ["best", "Best available"],
    ["handcuffs", "RB handcuffs"],
  ];

  return (
    <div className="fos">
      <div className="fos-bar">
        <div className="fos-filters" role="group" aria-label="Filter by open spots">
          <button className={`chip-filter ${only === 0 ? "on" : ""}`} onClick={() => setOnly(0)}>All {rows.length}</button>
          <button className={`chip-filter ${only === 1 ? "on" : ""}`} onClick={() => setOnly(1)}>1 open · {count(1)}</button>
          <button className={`chip-filter ${only === 2 ? "on" : ""}`} onClick={() => setOnly(2)}>2 open · {count(2)}</button>
          <button className={`chip-filter ${only === 3 ? "on" : ""}`} onClick={() => setOnly(3)}>3+ open · {count(3)}</button>
        </div>
        <div className="fos-filters" role="group" aria-label="Filter by what the league needs">
          <span className="fos-label">Needs</span>
          {needCounts.map(([p, n]) => (
            <button key={p} className={`chip-filter ${needFilter === p ? "on" : ""}`} disabled={n === 0 && needFilter !== p} onClick={() => setNeedFilter((f) => (f === p ? null : p))}>
              {p} · {n}
            </button>
          ))}
        </div>
        <div className="fos-filters" role="group" aria-label="Where suggestions come from">
          <span className="fos-label">Suggest</span>
          {SOURCES.map(([k, lbl]) => (
            <button key={k} className={`chip-filter ${source === k ? "on" : ""}`} onClick={() => setSource(k)}>{lbl}</button>
          ))}
        </div>
        <div className="fos-status" aria-live="polite">
          <b>{queue.length}</b> queued in <b>{queuedLeagues}</b> league{queuedLeagues === 1 ? "" : "s"} ·{" "}
          <span className={unfilled.length ? "fos-warn" : ""}>{unfilled.length} still {unfilled.length === 1 ? "has" : "have"} an empty spot</span>
          {unfilled.length > 0 && (
            <button type="button" className="fos-link" onClick={nextUnfilled}>Next ›</button>
          )}
          <button type="button" className="fos-link" onClick={() => setAllOpen(true)}>Expand all</button>
          <button type="button" className="fos-link" onClick={() => setAllOpen(false)}>Collapse all</button>
        </div>
        <div className="fos-actions">
          <button className="btn ghost sm" disabled={running || liveLoading} onClick={autoFill} title="Fill every shown league's open spots with its top suggestions">
            Auto-fill open spots
          </button>
          {running ? (
            <button className="btn ghost sm" onClick={() => (abortRef.current.aborted = true)}>Abort</button>
          ) : (
            <button className="btn sm" disabled={!token || pending.length === 0} onClick={() => setConfirming(true)}>
              Send {pending.length || ""} {pending.length === 1 ? "claim" : "claims"}
            </button>
          )}
        </div>
      </div>
      <p className="fos-note">
        {liveLoading ? "Reading rosters live from Sleeper… " : ""}
        Tap a suggestion to queue it. Suggestions are always players still free in that league, positions you&rsquo;re short at first.
        {source === "best" && " “Best available” uses Sleeper’s own popularity rank — Sleeper doesn’t publish roster %."}
        {source === "handcuffs" && " Handcuffs come from Sleeper’s depth chart; backups to RBs you roster are marked YOUR."}
      </p>
      {!token && <p className="fos-note fos-warn">Connect write access above to send.</p>}
      {extraNoDrop > 0 && (
        <p className="fos-note fos-warn">
          {extraNoDrop} claim{extraNoDrop === 1 ? "" : "s"} beyond your open spots ha{extraNoDrop === 1 ? "s" : "ve"} no drop — fine for waiver claims (they compete for the spot,
          first in your order wins), but a free agent can&rsquo;t be added without room.
        </p>
      )}
      {confirming && (
        <BulkConfirm
          title={`Send ${pending.length} add${pending.length === 1 ? "" : "s"} / claim${pending.length === 1 ? "" : "s"} across ${new Set(pending.map((q) => q.row.league.league.id)).size} leagues`}
          lines={pending.map((q) => (
            <span key={q.key}>
              {q.row.league.league.name}: add {nameOf(q.id)}
              {q.drop ? `, drop ${nameOf(q.drop)}` : ""}
              {isFaab(q.row.league) ? ` (bid $${bidFor(q.row.league, q.id)} if on waivers)` : ""}
            </span>
          ))}
          confirmLabel={`Send ${pending.length}`}
          onConfirm={start}
          onCancel={() => setConfirming(false)}
        />
      )}
      {summary && <p className="fos-note" style={{ color: summaryColor ?? "var(--bone)", fontWeight: summaryColor ? 650 : undefined }}>{summary}</p>}

      {flash && <p className="fos-note fos-flash">{flash}</p>}
      {across.length > 0 && (
        <div className="fos-across">
          <div className="fos-across-head">
            <span className="fos-label">Across your leagues</span>
            <span className="fos-note">free in several of the leagues shown — tap to queue him in every one that still has an empty spot</span>
          </div>
          <div className="fos-sugg">
            {across.map(({ s, leagues: ls }) => {
              const room = ls.filter((r) => pickList(r).length < r.spots && !pickList(r).includes(s.id)).length;
              return (
                <button key={s.id} type="button" className="fos-card" disabled={running || room === 0} onClick={() => queueEverywhere(s.id, ls)} title={`Queue ${nameOf(s.id)} in ${room} league${room === 1 ? "" : "s"}`}>
                  <PlayerAvatar playerId={s.id} pos={posOf(s.id)} size={30} />
                  <span className="fos-cbody">
                    <span className="fos-cname">{nameOf(s.id)}</span>
                    <span className="fos-cmeta">
                      <span className="pos" style={posChipStyle(posOf(s.id))}>{posOf(s.id)}</span> {pmap?.[s.id]?.t}
                      {pmap?.[s.id]?.inj ? <span className="fos-inj"> {INJ_SHORT[pmap[s.id].inj!] ?? pmap[s.id].inj}</span> : null}
                    </span>
                    <span className="fos-cnote">free in {ls.length} · {room ? `fits ${room}` : "no empty spot left"}</span>
                  </span>
                  <span className="fos-plus fos-plus-n" aria-hidden>{room ? `+${room}` : "✓"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="fos-note">{rows.length === 0 ? (liveLoading ? "Loading…" : "Every roster is full right now — nothing to add without a drop.") : "No leagues match this filter."}</p>
      ) : (
        <div className="fos-list">
          {shown.map((r) => {
            const l = r.league;
            const lid = l.league.id;
            const list = pickList(r);
            const needs = needsOf(r);
            const sugg = suggestionsFor(r).filter((s) => !list.includes(s.id));
            const visible = more.has(lid) ? sugg.slice(0, 24) : sugg.slice(0, 8);
            const left = budgetLeft(l);
            const irCap = inner(l.league.settings, "reserve_slots");
            const byPos = new Map<string, string[]>();
            for (const id of r.players.filter((x) => !r.reserve.includes(x))) {
              const p = POS_ORDER.includes(posOf(id)) ? posOf(id) : "OTH";
              byPos.set(p, [...(byPos.get(p) ?? []), id]);
            }
            const matches = searchMatches(r);
            return (
              <section key={lid} id={`fos-${lid}`} className={`fos-league ${isOpen(lid) ? "open" : "closed"}`} aria-label={l.league.name}>
                <header className="fos-head">
                  <button
                    type="button"
                    className="fos-toggle"
                    aria-expanded={isOpen(lid)}
                    aria-controls={`fos-body-${lid}`}
                    onClick={() => setOpenMap((m) => ({ ...m, [lid]: !isOpen(lid) }))}
                  >
                    <span className="fos-chev" aria-hidden>{isOpen(lid) ? "▾" : "▸"}</span>
                  </button>
                  <Link href={`/manager/${lid}`} className="fos-name">{l.league.name}</Link>
                  <span className="fos-spots" title={`${r.spots} empty roster spot${r.spots === 1 ? "" : "s"}`}>
                    {Array.from({ length: r.spots }, (_, i) => (
                      <span key={i} className={`fos-dot ${i < Math.min(list.length, r.spots) ? "filled" : ""}`} />
                    ))}
                    <b>{r.spots} open</b>
                  </span>
                  <span className="fos-meta">
                    {left != null ? `$${left} FAAB` : "no FAAB"}
                    {irCap > 0 ? ` · IR ${r.reserve.length}/${irCap}` : ""}
                    {!r.live ? " · not read live" : ""}
                  </span>
                </header>
                {!isOpen(lid) && (
                  <button type="button" className="fos-compact" onClick={() => setOpenMap((m) => ({ ...m, [lid]: true }))}>
                    {needs.filter((n) => n.short).map((n) => (
                      <span key={n.pos} className="fos-need short">{n.pos} short</span>
                    ))}
                    {needs.filter((n) => !n.short).map((n) => (
                      <span key={n.pos} className="fos-need">{n.pos} thin</span>
                    ))}
                    <span className="fos-compact-q">
                      {list.length ? list.map((id) => nameOf(id).split(" ").slice(-1)[0]).join(", ") : "nothing queued — open to pick"}
                    </span>
                  </button>
                )}
                {isOpen(lid) && (
                <div id={`fos-body-${lid}`} className="fos-body">

                <div className="fos-roster">
                  {POS_ORDER.concat("OTH").filter((p) => byPos.has(p)).map((p) => (
                    <div key={p} className="fos-posrow">
                      <span className="fos-pos" style={posChipStyle(p === "OTH" ? "" : p)}>{p}</span>
                      <span className="fos-players">
                        {byPos.get(p)!.map((id) => {
                          const inj = pmap?.[id]?.inj ?? "";
                          const starting = r.starters.includes(id);
                          return (
                            <span key={id} className={`fos-pl ${starting ? "start" : ""} ${isOut(id) ? "out" : ""}`} title={`${nameOf(id)}${starting ? " — starting" : ""}${inj ? ` — ${inj}` : ""}`}>
                              {nameOf(id).split(" ").slice(-1)[0]}
                              {inj && <sup>{INJ_SHORT[inj] ?? inj}</sup>}
                            </span>
                          );
                        })}
                      </span>
                    </div>
                  ))}
                  {r.reserve.length > 0 && (
                    <div className="fos-posrow">
                      <span className="fos-pos fos-ir">IR</span>
                      <span className="fos-players">
                        {r.reserve.map((id) => (
                          <span key={id} className="fos-pl out" title={`${nameOf(id)} — on IR`}>{nameOf(id).split(" ").slice(-1)[0]}</span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>

                <div className="fos-needs">
                  <span className="fos-label">Need</span>
                  {needs.length === 0 ? (
                    <span className="fos-ok">Depth looks fine — add the best player available</span>
                  ) : (
                    needs.map((n) => (
                      <span key={n.pos} className={`fos-need ${n.short ? "short" : ""}`}>
                        {n.pos} {n.short ? `short · ${Math.max(0, n.healthy)} healthy for ${n.slots}` : "no backup"}
                      </span>
                    ))
                  )}
                </div>

                {list.length > 0 && (
                  <ol className="fos-queue" aria-label="Your claims in this league, in priority order">
                    {list.map((id, i) => {
                      const k = `${lid}:${id}`;
                      const extra = i >= r.spots;
                      return (
                        <li key={id} className={`fos-q ${extra ? "extra" : ""}`}>
                          <span className="fos-qn">{i + 1}</span>
                          <PlayerAvatar playerId={id} pos={posOf(id)} size={26} />
                          <span className="fos-qname">
                            {nameOf(id)} <span className="fos-dim">{posOf(id)} · {pmap?.[id]?.t}</span>
                            <span className="fos-sub">{extra ? "extra claim — competes for the spot" : "fills an open spot · no drop"}</span>
                          </span>
                          {extra && (
                            <select
                              className="select sm"
                              value={dropPick[k] ?? ""}
                              disabled={running}
                              onChange={(e) => setDropPick((d) => ({ ...d, [k]: e.target.value }))}
                              aria-label={`Drop for ${nameOf(id)} (optional)`}
                            >
                              <option value="">no drop</option>
                              {dropOptions(r).map((d) => (
                                <option key={d} value={d} disabled={Object.entries(dropPick).some(([kk, v]) => v === d && kk.startsWith(`${lid}:`) && kk !== k)}>
                                  drop {nameOf(d)}{r.starters.includes(d) ? " (starting)" : ""}
                                </option>
                              ))}
                            </select>
                          )}
                          {isFaab(l) && (
                            <label className="fos-bid">
                              $
                              <input
                                type="number"
                                min={bidMin(l)}
                                max={left ?? undefined}
                                value={bidFor(l, id)}
                                disabled={running}
                                onChange={(e) => setBids((b) => ({ ...b, [k]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) }))}
                                aria-label={`FAAB bid for ${nameOf(id)}`}
                              />
                            </label>
                          )}
                          <span className="fos-qctl">
                            <button type="button" className="fos-icon" disabled={running || i === 0} onClick={() => movePick(r, id, -1)} aria-label="Move up">↑</button>
                            <button type="button" className="fos-icon" disabled={running || i === list.length - 1} onClick={() => movePick(r, id, 1)} aria-label="Move down">↓</button>
                            <button type="button" className="fos-icon" disabled={running} onClick={() => removePick(r, id)} aria-label={`Remove ${nameOf(id)}`}>✕</button>
                          </span>
                          <StatusCell status={status[k]} />
                        </li>
                      );
                    })}
                  </ol>
                )}

                <div className="fos-sugg">
                  {visible.map((s) => (
                    <button key={s.id} type="button" className="fos-card" disabled={running} onClick={() => addPick(r, s.id)} title={`Queue ${nameOf(s.id)}`}>
                      <PlayerAvatar playerId={s.id} pos={posOf(s.id)} size={30} />
                      <span className="fos-cbody">
                        <span className="fos-cname">{nameOf(s.id)}</span>
                        <span className="fos-cmeta">
                          <span className="pos" style={posChipStyle(posOf(s.id))}>{posOf(s.id)}</span> {pmap?.[s.id]?.t}
                          {pmap?.[s.id]?.inj ? <span className="fos-inj"> {INJ_SHORT[pmap[s.id].inj!] ?? pmap[s.id].inj}</span> : null}
                        </span>
                        {s.note && <span className="fos-cnote">{s.note}</span>}
                      </span>
                      <span className="fos-plus" aria-hidden>+</span>
                    </button>
                  ))}
                  {sugg.length === 0 && <span className="fos-note">{r.live ? "Nobody from this list is free here." : "Couldn't read this league live, so availability is unknown — search instead."}</span>}
                </div>
                <div className="fos-foot">
                  {sugg.length > 8 && (
                    <button type="button" className="fos-link" onClick={() => setMore((m) => { const n = new Set(m); if (n.has(lid)) n.delete(lid); else n.add(lid); return n; })}>
                      {more.has(lid) ? "Show fewer" : `Show ${Math.min(24, sugg.length) - 8} more`}
                    </button>
                  )}
                  <input
                    className="input fos-search"
                    placeholder="Search anyone free here…"
                    value={search[lid] ?? ""}
                    disabled={running}
                    onChange={(e) => setSearch((s) => ({ ...s, [lid]: e.target.value }))}
                  />
                  {matches.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="chip-filter"
                      onClick={() => {
                        addPick(r, id);
                        setSearch((s) => ({ ...s, [lid]: "" }));
                      }}
                    >
                      + {nameOf(id)} · {posOf(id)} {pmap?.[id]?.t}
                    </button>
                  ))}
                </div>
                </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
