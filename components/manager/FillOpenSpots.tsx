"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTrendingAdds, getTrendingDrops } from "@/lib/sleeper";
import { fetchAllLive, preflightRosters, type LiveRoster } from "@/lib/liveRosters";
import { addDropFreeAgent, cancelWaiverClaim, claimWaiver } from "@/lib/sleeperWrite";
import { bulkResultTone, errorMessage, type TaskStatus } from "@/lib/bulkRun";
import { classifyError, logActivity, newBatchId, recentlySent, type LogEntry } from "@/lib/bulkOps";
import { suggestBid, type FaabStats } from "@/lib/faabHistory";
import { buildStartingSlots, eligiblePositions } from "@/lib/rosterSlots";
import { posChipStyle } from "@/lib/players";
import type { PlayerMap } from "@/lib/types";
import type { LineupLeague } from "./LineupManager";
import type { Claim } from "@/lib/inbox";
import { PlayerAvatar } from "./Avatar";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useRefreshLeagues } from "./useRefreshLeagues";
import { useCuratedRanks } from "./useCuratedRanks";

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
  existingClaims,
  onSent,
  onClaimsChanged,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  // Your pending waiver claims (null = not read yet / no Sleeper access). Claims already placed count toward a league's empty spots.
  existingClaims?: Claim[] | null;
  onSent?: () => void;
  // Called after a claim is cancelled or its bid changed here, so the claims list is re-read from Sleeper.
  onClaimsChanged?: () => void;
}) {
  const pendingByLeague = useMemo(() => {
    const m = new Map<string, Claim[]>();
    for (const c of existingClaims ?? []) m.set(c.leagueId, [...(m.get(c.leagueId) ?? []), c]);
    return m;
  }, [existingClaims]);
  const claimedIn = (lid: string) => pendingByLeague.get(lid) ?? [];
  // Only claims with no drop take one of the empty spots; a claim that drops someone keeps the roster size the same.
  const spotClaims = (lid: string) => claimedIn(lid).filter((c) => !c.dropId).length;
  // Edit / cancel a claim that's already on Sleeper, right in the league's queue. Sleeper has no "edit bid", so a bid change =
  // cancel, then place the same add/drop again at the new bid (it moves to the end of your claim order in that league).
  const [claimBid, setClaimBid] = useState<Record<string, number>>({});
  const [claimBusy, setClaimBusy] = useState<Set<string>>(new Set());
  const [claimMsg, setClaimMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [gone, setGone] = useState<Set<string>>(new Set()); // cancelled here, hidden until the list is re-read
  const busyOn = (k: string, on: boolean) =>
    setClaimBusy((p) => {
      const n = new Set(p);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  const cancelClaim = async (c: Claim) => {
    if (!token) return;
    busyOn(c.key, true);
    try {
      await cancelWaiverClaim(token, { leagueId: c.leagueId, transactionId: c.transactionId, leg: c.leg });
      setGone((g) => new Set(g).add(c.key));
      onClaimsChanged?.();
    } catch (e) {
      setClaimMsg((m) => ({ ...m, [c.key]: { ok: false, text: `Cancel failed: ${errorMessage(e)}` } }));
    } finally {
      busyOn(c.key, false);
    }
  };
  const refresh = useRefreshLeagues();
  const curated = useCuratedRanks();
  // "Weak" = a player worth cutting first: no NFL team, or not on your /admin rankings and outside Sleeper's top 300 (or unranked),
  // or bottom tier (G) on your rankings and outside Sleeper's top 250. Offense only. Always shown with the reason — never a guess.
  const weakReason = (id: string): string | null => {
    const e = pmap?.[id];
    if (!e || !OFFENSE.has(e.p)) return null;
    if (!e.t) return "no NFL team";
    const rk = e.rk;
    const rkText = rk != null ? `Sleeper #${rk}` : "unranked on Sleeper";
    const c = curated?.get(id);
    if (!c) return rk == null || rk > 300 ? `not on your rankings · ${rkText}` : null;
    if (c.tier >= 8 && (rk == null || rk > 250)) return `bottom tier on your rankings · ${rkText}`;
    return null;
  };
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
  const [order, setOrder] = useState<Record<string, string[]>>({}); // leagueId -> item keys in claim order (drag to change)
  const [drag, setDrag] = useState<{ lid: string; key: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // league whose "Apply" is waiting for its confirm click
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
    const claimedIds = new Set(claimedIn(r.league.league.id).map((c) => c.addId));
    const free = (id: string) => OFFENSE.has(posOf(id)) && !!pmap?.[id]?.t && !taken.has(id) && !r.players.includes(id) && !claimedIds.has(id);
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
  const autoFill = () => {
    const next = { ...picks };
    for (const r of shown) {
      if (!r.live) continue; // without a live read we can't tell who's still free there
      const room = Math.max(0, r.spots - spotClaims(r.league.league.id));
      const cur = (next[r.league.league.id] ?? []).slice(0, room);
      for (const s of suggestionsFor(r)) {
        if (cur.length >= room) break;
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
    r.players
      .filter((id) => !r.reserve.includes(id))
      .sort((a, b) => Number(weakReason(b) !== null) - Number(weakReason(a) !== null) || (pmap?.[b]?.rk ?? 1e9) - (pmap?.[a]?.rk ?? 1e9));

  const queue = rows.flatMap((r) =>
    pickList(r).map((id, i) => {
      const lid = r.league.league.id;
      return { key: `${lid}:${id}`, row: r, id, drop: spotClaims(lid) + i >= r.spots ? dropPick[`${lid}:${id}`] || undefined : undefined };
    })
  );
  const extraNoDrop = queue.filter((q) => spotClaims(q.row.league.league.id) + pickList(q.row).indexOf(q.id) >= q.row.spots && !q.drop).length;

  // ---- multi-league helpers
  const needsByLeague = new Map(shownBySpots.map((r) => [r.league.league.id, needsOf(r)]));
  const needCounts = ["QB", "RB", "WR", "TE"].map((p) => [p, shownBySpots.filter((r) => (needsByLeague.get(r.league.league.id) ?? []).some((n) => n.pos === p || (n.pos === "FLEX" && p !== "QB"))).length] as const);
  const weakIn = (r: Row) => r.players.filter((id) => !r.reserve.includes(id) && weakReason(id) !== null);
  const weakLeagues = shownBySpots.filter((r) => weakIn(r).length > 0).length;
  // Leagues with an empty spot and NO waiver claim on Sleeper yet (claims with a drop don't count — they don't use the spot).
  const noClaimLeagues = shownBySpots.filter((r) => claimedIn(r.league.league.id).length === 0).length;
  const shown =
    needFilter === "NOCLAIM"
      ? shownBySpots.filter((r) => claimedIn(r.league.league.id).length === 0)
      : needFilter === "WEAK"
      ? shownBySpots.filter((r) => weakIn(r).length > 0)
      : needFilter
        ? shownBySpots.filter((r) => (needsByLeague.get(r.league.league.id) ?? []).some((n) => n.pos === needFilter || (n.pos === "FLEX" && needFilter !== "QB")))
        : shownBySpots;
  const isOpen = (lid: string) => openMap[lid] ?? shown.length <= 3;
  const setAllOpen = (on: boolean) => setOpenMap(Object.fromEntries(shown.map((r) => [r.league.league.id, on])));
  const unfilled = shown.filter((r) => pickList(r).length + spotClaims(r.league.league.id) < r.spots);
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
  // "Add one player to every league": search anyone, then queue him in every shown league where he's still free —
  // either only where an empty spot is left, or in all of them (beyond the empty spots he becomes an extra claim, no drop).
  const [oneQuery, setOneQuery] = useState("");
  const oneMatches = (() => {
    const q = oneQuery.trim().toLowerCase();
    if (q.length < 2 || !pmap) return [] as string[];
    const out: string[] = [];
    for (const [id, e] of Object.entries(pmap)) {
      if (!OFFENSE.has(e.p) || !e.t || !e.n.toLowerCase().includes(q)) continue;
      out.push(id);
    }
    return out.sort((a, b) => (pmap[a]?.rk ?? 1e9) - (pmap[b]?.rk ?? 1e9)).slice(0, 6);
  })();
  const freeLeaguesFor = (id: string) =>
    shown.filter((r) => !!r.live && !takenIn(r).has(id) && !r.players.includes(id) && !claimedIn(r.league.league.id).some((c) => c.addId === id));
  const queueInAll = (id: string) => {
    const ls = freeLeaguesFor(id);
    let n = 0;
    const next = { ...picks };
    for (const r of ls) {
      const cur = next[r.league.league.id] ?? [];
      if (cur.includes(id)) continue;
      next[r.league.league.id] = [...cur, id];
      n++;
    }
    setPicks(next);
    setFlash(n ? `Queued ${nameOf(id)} in ${n} league${n === 1 ? "" : "s"} — press Apply all to send.` : `${nameOf(id)} isn't free in any shown league (or is already queued/claimed).`);
    setOneQuery("");
  };
  const queueEverywhere = (id: string, leaguesFree: Row[]) => {
    let n = 0;
    const next = { ...picks };
    for (const r of leaguesFree) {
      const cur = next[r.league.league.id] ?? [];
      if (cur.includes(id) || cur.length + spotClaims(r.league.league.id) >= r.spots) continue; // only into a still-empty spot — never an extra claim
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

  // ---- one ordered claim list per league (placed on Sleeper + queued here), drag to reorder, Apply to save.
  type Item = { key: string; kind: "placed"; c: Claim } | { key: string; kind: "queued"; id: string };
  const placedOf = (lid: string) => claimedIn(lid).filter((c) => !gone.has(c.key));
  const itemsOf = (r: Row): Item[] => {
    const lid = r.league.league.id;
    const all: Item[] = [
      ...placedOf(lid).map((c) => ({ key: `c:${c.key}`, kind: "placed" as const, c })),
      ...pickList(r).map((id) => ({ key: `p:${id}`, kind: "queued" as const, id })),
    ];
    const byKey = new Map(all.map((i) => [i.key, i]));
    const saved = (order[lid] ?? []).filter((k) => byKey.has(k));
    for (const i of all) if (!saved.includes(i.key)) saved.push(i.key);
    return saved.map((k) => byKey.get(k)!);
  };
  const bidChanged = (c: Claim) => c.key in claimBid && claimBid[c.key] !== (c.bid ?? 0);
  // Re-placing is needed when a placed claim's bid changed, placed claims were reordered, or a new pick was dragged ABOVE a
  // placed claim — Sleeper has no edit/reorder call, so those claims are cancelled and placed again in the new order.
  const rebuildNeeded = (r: Row) => {
    const lid = r.league.league.id;
    const items = itemsOf(r);
    const placed = placedOf(lid);
    if (placed.some(bidChanged)) return true;
    const seq = items.filter((i) => i.kind === "placed").map((i) => i.key).join();
    if (seq !== placed.map((c) => `c:${c.key}`).join()) return true;
    const lastPlaced = items.map((i) => i.kind).lastIndexOf("placed");
    const firstQueued = items.findIndex((i) => i.kind === "queued");
    return firstQueued >= 0 && firstQueued < lastPlaced;
  };
  const queuedLeft = (r: Row) => pickList(r).filter((id) => status[`${r.league.league.id}:${id}`]?.kind !== "done");
  const isDirty = (r: Row) => queuedLeft(r).length > 0 || rebuildNeeded(r);
  const moveItem = (r: Row, from: string, to: string) => {
    if (from === to) return;
    const keys = itemsOf(r).map((i) => i.key);
    const a = keys.indexOf(from);
    const b = keys.indexOf(to);
    if (a < 0 || b < 0) return;
    keys.splice(b, 0, keys.splice(a, 1)[0]);
    setOrder((o) => ({ ...o, [r.league.league.id]: keys }));
  };
  const nudge = (r: Row, key: string, dir: -1 | 1) => {
    const keys = itemsOf(r).map((i) => i.key);
    const a = keys.indexOf(key);
    const b = a + dir;
    if (a < 0 || b < 0 || b >= keys.length) return;
    [keys[a], keys[b]] = [keys[b], keys[a]];
    setOrder((o) => ({ ...o, [r.league.league.id]: keys }));
  };
  const describeApply = (r: Row) => {
    const n = queuedLeft(r).length;
    const re = rebuildNeeded(r) ? placedOf(r.league.league.id).length : 0;
    return [n ? `send ${n} new` : "", re ? `re-place ${re} existing (cancel + place again in your order/bids)` : ""].filter(Boolean).join(" · ");
  };

  // Apply one league: optionally cancel the placed claims (when their order/bids changed), then place everything in the order shown.
  // Shared bulk framework hooks (this page keeps its own ordered send, since claim order matters): a duplicate guard for new
  // picks across reloads, honest "uncertain" outcomes on timeouts, and every outcome written to the activity log.
  const opKeyOf = (lid: string, id: string, drop?: string) => `fill_spots:${lid}:add:${id}:drop:${drop ?? "-"}`;
  const applyLeague = async (
    r: Row,
    ctx: { sentBefore: Set<string> | null; log: LogEntry[]; batchId: string }
  ): Promise<{ done: number; failed: number; auth: boolean }> => {
    const l = r.league;
    const lid = l.league.id;
    const entry = (playerId: string, action: string, status: LogEntry["status"], message: string | null, opKey: string | null, kind = "execute") =>
      ctx.log.push({ kind, tool: "fill_spots", status, leagueId: lid, leagueName: l.league.name, playerId, playerName: nameOf(playerId), action, message, batchId: ctx.batchId, opKey });
    const items = itemsOf(r);
    const rebuild = rebuildNeeded(r);
    const set = (k: string, s: TaskStatus) => setStatus((prev) => ({ ...prev, [k]: s }));
    let done = 0;
    let failed = 0;
    const pre = await preflightRosters([
      { leagueId: lid, rosterId: l.roster!.rosterId, base: r.live ? { starters: r.live.starters, players: r.live.players, reserve: r.live.reserve } : null, strictStarters: false },
    ]);
    const p = pre[lid];
    if (p?.blocked) {
      for (const i of items) set(i.kind === "placed" ? i.c.key : `${lid}:${i.id}`, { kind: "failed", message: p.blocked });
      return { done: 0, failed: items.length, auth: false };
    }
    if (rebuild) {
      for (const i of items) {
        if (i.kind !== "placed") continue;
        try {
          set(i.c.key, { kind: "running" });
          await cancelWaiverClaim(token!, { leagueId: lid, transactionId: i.c.transactionId, leg: i.c.leg });
          if (i.c.addId) entry(i.c.addId, `cancel claim for ${nameOf(i.c.addId)} (to re-place)`, "ok", null, null);
        } catch (e) {
          if (i.c.addId) entry(i.c.addId, `cancel claim for ${nameOf(i.c.addId)} (to re-place)`, classifyError(e), errorMessage(e), null);
          set(i.c.key, { kind: "failed", message: `Couldn't cancel to re-order — nothing else changed in this league: ${errorMessage(e)}` });
          return { done, failed: failed + 1, auth: isAuth(e) };
        }
      }
    }
    for (const [idx, i] of items.entries()) {
      if (i.kind === "placed") {
        if (!rebuild) continue;
        const c = i.c;
        const bid = c.key in claimBid ? claimBid[c.key] : c.bid ?? 0;
        try {
          await claimWaiver(token!, { leagueId: lid, rosterId: l.roster!.rosterId, addPlayerId: c.addId!, dropPlayerId: c.dropId ?? undefined, bid });
          set(c.key, { kind: "done", note: `re-placed${isFaab(l) ? ` $${bid}` : ""}` });
          entry(c.addId!, `re-place claim for ${nameOf(c.addId!)}${isFaab(l) ? ` ($${bid})` : ""}`, "submitted", null, null);
          done++;
        } catch (e) {
          entry(c.addId!, `re-place claim for ${nameOf(c.addId!)}`, classifyError(e), errorMessage(e), null);
          set(c.key, { kind: "failed", message: `Cancelled but couldn't place again: ${errorMessage(e)} — queue him again.` });
          failed++;
          if (isAuth(e)) return { done, failed, auth: true };
        }
        continue;
      }
      const k = `${lid}:${i.id}`;
      if (status[k]?.kind === "done") continue;
      if (p?.fresh?.allRostered?.includes(i.id)) {
        set(k, { kind: "failed", message: `${nameOf(i.id)} was just taken in this league — nothing sent.` });
        failed++;
        continue;
      }
      const drop = idx >= r.spots ? dropPick[k] || undefined : undefined;
      if (drop && p?.fresh && !p.fresh.players.includes(drop)) {
        set(k, { kind: "failed", message: `${nameOf(drop)} is no longer on this roster — nothing sent.` });
        failed++;
        continue;
      }
      const base = { leagueId: lid, rosterId: l.roster!.rosterId, addPlayerId: i.id, ...(drop ? { dropPlayerId: drop } : {}) };
      const opKey = opKeyOf(lid, i.id, drop);
      const action = `add ${nameOf(i.id)}${drop ? `, drop ${nameOf(drop)}` : ""}`;
      if (ctx.sentBefore?.has(opKey)) {
        set(k, { kind: "failed", message: "Already sent in the last 30 minutes — not sent again. Check Sleeper." });
        entry(i.id, action, "skipped", "already sent in the last 30 min (duplicate guard)", opKey, "skip");
        failed++;
        continue;
      }
      set(k, { kind: "running" });
      try {
        try {
          await addDropFreeAgent(token!, base);
          set(k, { kind: "done", note: drop ? `added (dropped ${nameOf(drop)})` : "added" });
          entry(i.id, action, "ok", null, opKey);
        } catch (e) {
          if (!(e instanceof Error && /waiver/i.test(e.message))) throw e;
          const bid = isFaab(l) ? bidFor(l, i.id) : 0;
          await claimWaiver(token!, { ...base, bid });
          set(k, { kind: "done", note: isFaab(l) ? `claim placed ($${bid})` : "claim placed" });
          entry(i.id, `claim ${nameOf(i.id)}${isFaab(l) ? ` ($${bid})` : ""}${drop ? `, drop ${nameOf(drop)}` : ""}`, "submitted", null, opKey);
        }
        done++;
      } catch (e) {
        const how = isAuth(e) ? "failed" : classifyError(e);
        set(k, { kind: "failed", message: how === "uncertain" ? `Outcome unknown (${errorMessage(e)}) — check Sleeper before trying again.` : errorMessage(e) });
        entry(i.id, action, how, errorMessage(e), opKey);
        failed++;
        if (isAuth(e)) return { done, failed, auth: true };
      }
    }
    return { done, failed, auth: false };
  };
  const isAuth = (e: unknown) => e instanceof Error && /unauthori|token|401/i.test(e.message);

  const applyLeagues = async (list: Row[]) => {
    if (!token || list.length === 0) return;
    setConfirming(false);
    setArmed(null);
    setRunning(true);
    setSummary("");
    setSummaryColor(undefined);
    abortRef.current = { aborted: false };
    let done = 0;
    let failed = 0;
    let auth = false;
    const touched: string[] = [];
    const keys = list.flatMap((r) => {
      const lid = r.league.league.id;
      return itemsOf(r).flatMap((i, idx) => (i.kind === "placed" ? [] : [opKeyOf(lid, i.id, idx >= r.spots ? dropPick[`${lid}:${i.id}`] || undefined : undefined)]));
    });
    const ctx = { sentBefore: await recentlySent(keys), log: [] as LogEntry[], batchId: newBatchId() };
    for (const r of list) {
      if (abortRef.current.aborted || auth) break;
      const res = await applyLeague(r, ctx);
      done += res.done;
      failed += res.failed;
      auth = res.auth;
      touched.push(r.league.league.id);
      setOrder((o) => {
        const n = { ...o };
        delete n[r.league.league.id];
        return n;
      });
    }
    setClaimBid((b) => Object.fromEntries(Object.entries(b).filter(([k]) => !touched.some((lid) => k.startsWith(`${lid}:`)))));
    const logged = await logActivity(ctx.log);
    setRunning(false);
    if (done > 0) {
      onSent?.();
      onClaimsChanged?.();
    }
    const refreshed = done > 0 ? await refresh(touched) : null;
    const tone = bulkResultTone({ done, failed });
    setSummaryColor(tone.color);
    setSummary(
      `${tone.prefix}${done} change${done === 1 ? "" : "s"} applied in ${touched.length} league${touched.length === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.` +
        (auth ? " Stopped — Sleeper rejected the login token; reconnect above." : "") +
        (refreshed === null ? "" : refreshed ? " Fantis's data was refreshed for those leagues." : "") +
        (ctx.sentBefore === null ? " ⚠ Couldn't check the activity log for recent duplicates." : "") +
        (logged ? "" : " ⚠ Couldn't write to the activity log.")
    );
  };
  const dirtyRows = rows.filter(isDirty);

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
          <button
            className={`chip-filter ${needFilter === "NOCLAIM" ? "on" : ""}`}
            disabled={(existingClaims == null || noClaimLeagues === 0) && needFilter !== "NOCLAIM"}
            onClick={() => setNeedFilter((f) => (f === "NOCLAIM" ? null : "NOCLAIM"))}
            title={existingClaims == null ? "Connect Sleeper access above to read your claims" : "Leagues with no waiver claims queued on Sleeper"}
          >
            No waivers queued · {existingClaims == null ? "–" : noClaimLeagues}
          </button>
          <button
            className={`chip-filter ${needFilter === "WEAK" ? "on" : ""}`}
            disabled={weakLeagues === 0 && needFilter !== "WEAK"}
            onClick={() => setNeedFilter((f) => (f === "WEAK" ? null : "WEAK"))}
            title="Leagues with players worth cutting"
          >
            Weak players · {weakLeagues}
          </button>
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
            <button className="btn sm" disabled={!token || dirtyRows.length === 0} onClick={() => setConfirming(true)}>
              Apply all{dirtyRows.length ? ` · ${dirtyRows.length} league${dirtyRows.length === 1 ? "" : "s"}` : ""}
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
          title={`Apply changes in ${dirtyRows.length} league${dirtyRows.length === 1 ? "" : "s"}`}
          summary="Leagues go one at a time, claims in the order shown. Re-placing cancels those claims first, then places them again in your order with your bids."
          lines={dirtyRows.map((r) => (
            <span key={r.league.league.id}>
              {r.league.league.name}: {describeApply(r)}
            </span>
          ))}
          confirmLabel={`Apply ${dirtyRows.length}`}
          onConfirm={() => applyLeagues(dirtyRows)}
          onCancel={() => setConfirming(false)}
        />
      )}
      {summary && <p className="fos-note" style={{ color: summaryColor ?? "var(--bone)", fontWeight: summaryColor ? 650 : undefined }}>{summary}</p>}

      <div className="fos-one">
        <span className="fos-label">Add one player to every league</span>
        <input
          className="input fos-search"
          placeholder="Search a player…"
          value={oneQuery}
          disabled={running || liveLoading}
          onChange={(e) => setOneQuery(e.target.value)}
          aria-label="Player to queue in every league"
        />
        {oneMatches.map((id) => {
          const free = freeLeaguesFor(id);
          const withRoom = free.filter((r) => pickList(r).length + spotClaims(r.league.league.id) < r.spots && !pickList(r).includes(id));
          return (
            <span key={id} className="fos-onerow">
              <PlayerAvatar playerId={id} pos={posOf(id)} size={24} />
              <b>{nameOf(id)}</b> <span className="fos-dim">{posOf(id)} · {pmap?.[id]?.t} · free in {free.length}</span>
              <button type="button" className="btn ghost sm" disabled={running || withRoom.length === 0} onClick={() => { queueEverywhere(id, free); setOneQuery(""); }}>
                Empty spots only · {withRoom.length}
              </button>
              <button type="button" className="btn sm" disabled={running || free.length === 0} onClick={() => queueInAll(id)}>
                All leagues · {free.length}
              </button>
            </span>
          );
        })}
      </div>
      {flash && <p className="fos-note fos-flash">{flash}</p>}
      {across.length > 0 && (
        <div className="fos-across">
          <div className="fos-across-head">
            <span className="fos-label">Across your leagues</span>
            <span className="fos-note">free in several of the leagues shown — tap to queue him in every one that still has an empty spot</span>
          </div>
          <div className="fos-sugg">
            {across.map(({ s, leagues: ls }) => {
              const room = ls.filter((r) => pickList(r).length + spotClaims(r.league.league.id) < r.spots && !pickList(r).includes(s.id)).length;
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
            const placed = claimedIn(lid).filter((c) => !gone.has(c.key));
            const incoming = new Map<string, { id: string; kind: "claimed" | "queued" }[]>();
            for (const c of placed) if (c.addId) incoming.set(posOf(c.addId) || "OTH", [...(incoming.get(posOf(c.addId) || "OTH") ?? []), { id: c.addId, kind: "claimed" }]);
            for (const id of list) incoming.set(posOf(id) || "OTH", [...(incoming.get(posOf(id) || "OTH") ?? []), { id, kind: "queued" }]);
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
                      <span key={i} className={`fos-dot ${i < spotClaims(lid) ? "claimed" : i < Math.min(spotClaims(lid) + list.length, r.spots) ? "filled" : ""}`} />
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
                    {weakIn(r).length > 0 && (
                      <span className="fos-need weakpill" title={weakIn(r).map((id) => `${nameOf(id)} — ${weakReason(id)}`).join(", ")}>
                        {weakIn(r).length} weak
                      </span>
                    )}
                    {claimedIn(lid).filter((c) => !gone.has(c.key)).map((c) => (
                      <span key={c.key} className="fos-claimchip" title="Claim already placed on Sleeper">
                        claimed {c.addId ? nameOf(c.addId).split(" ").slice(-1)[0] : "?"}
                        {c.bid != null ? <b> ${c.bid}</b> : null}
                      </span>
                    ))}
                    <span className="fos-compact-q">
                      {list.length
                        ? `queued: ${list.map((id) => nameOf(id).split(" ").slice(-1)[0]).join(", ")}`
                        : claimedIn(lid).length
                          ? ""
                          : "nothing queued — open to pick"}
                    </span>
                  </button>
                )}
                {isOpen(lid) && (
                <div id={`fos-body-${lid}`} className="fos-body">

                <div className="fos-roster">
                  {POS_ORDER.concat("OTH").filter((p) => byPos.has(p) || incoming.has(p)).map((p) => (
                    <div key={p} className="fos-posrow">
                      <span className="fos-pos" style={posChipStyle(p === "OTH" ? "" : p)}>{p}</span>
                      <span className="fos-players">
                        {(byPos.get(p) ?? []).map((id) => {
                          const inj = pmap?.[id]?.inj ?? "";
                          const starting = r.starters.includes(id);
                          const weak = weakReason(id);
                          return (
                            <span key={id} className={`fos-pl ${starting ? "start" : ""} ${isOut(id) ? "out" : ""} ${weak ? "weak" : ""}`} title={`${nameOf(id)}${starting ? " — starting" : ""}${inj ? ` — ${inj}` : ""}${weak ? ` — weak: ${weak}` : ""}`}>
                              {nameOf(id).split(" ").slice(-1)[0]}
                              {inj && <sup>{INJ_SHORT[inj] ?? inj}</sup>}
                            </span>
                          );
                        })}
                        {(incoming.get(p) ?? []).map(({ id, kind }) => (
                          <span key={`in-${id}`} className={`fos-pl incoming ${kind}`} title={`${nameOf(id)} — ${kind === "claimed" ? "claim placed on Sleeper" : "queued here, not sent yet"}`}>
                            +{nameOf(id).split(" ").slice(-1)[0]}
                          </span>
                        ))}
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
                {weakIn(r).length > 0 && (
                  <div className="fos-needs">
                    <span className="fos-label">Cut first</span>
                    {weakIn(r).map((id) => (
                      <span key={id} className="fos-weak" title={weakReason(id) ?? ""}>
                        {nameOf(id)} <span className="fos-dim">{posOf(id)} · {weakReason(id)}</span>
                        {r.starters.includes(id) ? <b> · starting</b> : null}
                      </span>
                    ))}
                  </div>
                )}

                {itemsOf(r).length > 0 && (
                  <>
                  <ol className="fos-queue" aria-label="Your claims in this league, in priority order — drag to reorder">
                    {itemsOf(r).map((it, idx, arr) => {
                      const dragging = drag?.lid === lid && drag.key === it.key;
                      const common = {
                        draggable: !running,
                        onDragStart: (e: React.DragEvent) => {
                          e.dataTransfer.effectAllowed = "move";
                          setDrag({ lid, key: it.key });
                        },
                        onDragEnd: () => {
                          setDrag(null);
                          setOver(null);
                        },
                        onDragOver: (e: React.DragEvent) => {
                          if (drag?.lid !== lid) return;
                          e.preventDefault();
                          if (over !== it.key) setOver(it.key);
                        },
                        onDrop: (e: React.DragEvent) => {
                          e.preventDefault();
                          if (drag?.lid === lid) moveItem(r, drag.key, it.key);
                          setDrag(null);
                          setOver(null);
                        },
                      };
                      const cls = `fos-q ${dragging ? "dragging" : ""} ${over === it.key && !dragging ? "over" : ""}`;
                      const handle = (
                        <span className="fos-grip" aria-hidden title="Drag to reorder">
                          <svg width="10" height="16" viewBox="0 0 10 16"><circle cx="2" cy="3" r="1.5" /><circle cx="8" cy="3" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="2" cy="13" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg>
                        </span>
                      );
                      const arrows = (
                        <span className="fos-qctl">
                          <button type="button" className="fos-icon" disabled={running || idx === 0} onClick={() => nudge(r, it.key, -1)} aria-label="Move up">↑</button>
                          <button type="button" className="fos-icon" disabled={running || idx === arr.length - 1} onClick={() => nudge(r, it.key, 1)} aria-label="Move down">↓</button>
                        </span>
                      );
                      if (it.kind === "placed") {
                        const c = it.c;
                        const id = c.addId ?? "";
                        const cur = c.key in claimBid ? claimBid[c.key] : c.bid ?? 0;
                        const msg = claimMsg[c.key];
                        return (
                          <li key={it.key} className={`${cls} placed ${bidChanged(c) ? "edited" : ""}`} {...common}>
                            {handle}
                            <span className="fos-qn">{idx + 1}</span>
                            <PlayerAvatar playerId={id} pos={posOf(id)} size={26} />
                            <span className="fos-qname">
                              {id ? nameOf(id) : "Unknown player"} <span className="fos-dim">{posOf(id)} · {pmap?.[id]?.t}</span>
                              <span className="fos-sub">
                                on Sleeper{c.dropId ? ` · drops ${nameOf(c.dropId)}` : " · no drop"}
                                {bidChanged(c) ? ` · bid ${c.bid ?? 0} → ${cur}, apply to save` : ""}
                                {msg && <span style={{ color: msg.ok ? "var(--mint)" : "var(--red)" }}> — {msg.text}</span>}
                              </span>
                            </span>
                            {isFaab(l) && (
                              <label className="fos-bid">
                                $
                                <input
                                  type="number"
                                  min={0}
                                  max={left ?? undefined}
                                  value={cur}
                                  disabled={running || claimBusy.has(c.key)}
                                  onChange={(e) => setClaimBid((b) => ({ ...b, [c.key]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) }))}
                                  aria-label={`FAAB bid on the placed claim for ${id ? nameOf(id) : "this player"}`}
                                />
                              </label>
                            )}
                            {arrows}
                            <button type="button" className="btn ghost sm" disabled={!token || running || claimBusy.has(c.key)} onClick={() => cancelClaim(c)}>
                              {claimBusy.has(c.key) ? "Working…" : "Cancel claim"}
                            </button>
                            <StatusCell status={status[c.key]} />
                          </li>
                        );
                      }
                      const pid = it.id;
                      const k = `${lid}:${pid}`;
                      const extra = idx >= r.spots;
                      return (
                        <li key={it.key} className={`${cls} ${extra ? "extra" : ""}`} {...common}>
                          {handle}
                          <span className="fos-qn">{idx + 1}</span>
                          <PlayerAvatar playerId={pid} pos={posOf(pid)} size={26} />
                          <span className="fos-qname">
                            {nameOf(pid)} <span className="fos-dim">{posOf(pid)} · {pmap?.[pid]?.t}</span>
                            <span className="fos-sub">{extra ? "not sent yet · extra claim — competes for the spot" : "not sent yet · fills an open spot · no drop"}</span>
                          </span>
                          {extra && (
                            <select
                              className="select sm"
                              value={dropPick[k] ?? ""}
                              disabled={running}
                              onChange={(e) => setDropPick((d) => ({ ...d, [k]: e.target.value }))}
                              aria-label={`Drop for ${nameOf(pid)} (optional)`}
                            >
                              <option value="">no drop</option>
                              {dropOptions(r).map((d) => (
                                <option key={d} value={d} disabled={Object.entries(dropPick).some(([kk, v]) => v === d && kk.startsWith(`${lid}:`) && kk !== k)}>
                                  drop {nameOf(d)}{r.starters.includes(d) ? " (starting)" : ""}{weakReason(d) ? " · weak" : ""}
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
                                value={bidFor(l, pid)}
                                disabled={running}
                                onChange={(e) => setBids((b) => ({ ...b, [k]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) }))}
                                aria-label={`FAAB bid for ${nameOf(pid)}`}
                              />
                            </label>
                          )}
                          {arrows}
                          <button type="button" className="fos-icon" disabled={running} onClick={() => removePick(r, pid)} aria-label={`Remove ${nameOf(pid)}`}>✕</button>
                          <StatusCell status={status[k]} />
                        </li>
                      );
                    })}
                  </ol>
                  {isDirty(r) && (
                    <div className="fos-apply">
                      <span className="fos-dim">{describeApply(r)}</span>
                      {armed === lid ? (
                        <>
                          <button type="button" className="btn sm" disabled={!token || running} onClick={() => applyLeagues([r])}>Confirm — send to Sleeper</button>
                          <button type="button" className="btn ghost sm" disabled={running} onClick={() => setArmed(null)}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="btn sm" disabled={!token || running} onClick={() => setArmed(lid)}>Apply this league</button>
                      )}
                    </div>
                  )}
                  </>
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
