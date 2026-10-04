"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getProjections } from "@/lib/sleeper";
import { getWeekKickoffs } from "@/lib/espnGames";
import { BYE_WEEKS_2026 } from "@/lib/byeWeeks";
import { buildStartingSlots } from "@/lib/rosterSlots";
import { optimizeLineup, type OptimizeResult } from "@/lib/lineupOptimizer";
import { applyPick, diffLineups, slotLocked, slotOptions, type EditCtx } from "@/lib/lineupEdit";
import { TIER_LABELS } from "@/lib/players";
import { runBulk, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { setStarters } from "@/lib/sleeperWrite";
import { preflightRosters } from "@/lib/liveRosters";
import { kickoffSlot, kickoffSlotLabel } from "@/lib/kickoffSlot";
import type { PlayerMap, ProjectionMap } from "@/lib/types";
import { scoringKey } from "@/lib/scoringKey";
import type { PlayerPrefs } from "@/lib/playerPrefs";
import type { LineupLeague } from "./LineupManager";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useRefreshLeagues } from "./useRefreshLeagues";
import { useCuratedRanks } from "./useCuratedRanks";

// Statuses that score nothing this week. Doubtful/Questionable stay
// eligible (they might play) and are just flagged next to the name.
const OUT_STATUSES = new Set(["Out", "IR", "PUP", "Sus", "COV", "NA", "DNR"]);

// NFL regular season is 18 weeks (17 games + 1 bye per team) — the practical
// ceiling for "which week", including "All weeks".
const LAST_WEEK = 18;

// Real kickoff window (Thu / Fri / Sat / Sun early / Sun late / Mon), judged in Pacific time from the same ISO kickoff
// times used for lock checks — see lib/kickoffSlot.ts. (It used to use the browser's own time zone.)
const dayOfWeek = kickoffSlot;

// Long-term designations that keep a player out of LATER weeks' lineups. "Out" / "COV" are this week's status and
// are assumed over by a later week (toggle below), so they're not in here.
const LONG_TERM_OUT = new Set(["IR", "PUP", "Sus", "NA", "DNR"]);

// "Set ahead" covers the rest of the regular season. Week 18 is deliberately excluded (most leagues' playoffs end by 17).
const AHEAD_LAST = 17;

interface WeekData {
  proj: ProjectionMap;
  kickoffs: Record<string, string>;
  loadedAt: number;
}

interface Row {
  key: string;
  week: number;
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
  onSent,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  currentWeek: number;
  season: string;
  prefs: PlayerPrefs;
  prefsDirty: boolean;
  onEditPrefs: () => void;
  // Called after at least one lineup was sent, so the page can re-read live rosters.
  onSent?: () => void;
}) {
  // Which week(s) to optimize: a single real week number, or every remaining
  // week of the season (currentWeek..18) at once — e.g. setting lineups a
  // week or more ahead of time from this week's projections, to revisit
  // closer to game time as they firm up.
  const [selectedWeek, setSelectedWeek] = useState<number | "all" | "ahead">(currentWeek);
  const weeksToShow = useMemo(
    () =>
      selectedWeek === "all"
        ? Array.from({ length: Math.max(0, LAST_WEEK - currentWeek + 1) }, (_, i) => currentWeek + i)
        : selectedWeek === "ahead"
          ? Array.from({ length: Math.max(0, AHEAD_LAST - currentWeek) }, (_, i) => currentWeek + 1 + i)
          : [selectedWeek],
    [selectedWeek, currentWeek]
  );

  const [weekData, setWeekData] = useState<Record<number, WeekData>>({});
  const [loadError, setLoadError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const missing = weeksToShow.filter((w) => !(w in weekData));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((w) =>
        Promise.all([getProjections(season, w), getWeekKickoffs(season, w).catch(() => ({}))]).then(
          ([proj, kickoffs]): [number, WeekData] => [w, { proj, kickoffs, loadedAt: Date.now() }]
        )
      )
    )
      .then((entries) => {
        if (cancelled) return;
        setWeekData((prev) => {
          const next = { ...prev };
          for (const [w, data] of entries) next[w] = data;
          return next;
        });
        setLoadError("");
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Couldn't load projections.");
      });
    return () => {
      cancelled = true;
    };
    // reloadTick forces a refetch of the currently-selected week(s) by
    // clearing them from weekData first (see the Reload handler below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, weeksToShow, reloadTick]);

  const reload = () => {
    setWeekData((prev) => {
      const next = { ...prev };
      for (const w of weeksToShow) delete next[w];
      return next;
    });
    setReloadTick((t) => t + 1);
  };

  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const abortRef = useRef({ aborted: false });
  const refresh = useRefreshLeagues();

  // "rankings": your /admin order decides who starts (projections only order
  // players you haven't ranked); "projections": pure best projection. The
  // My players priority/avoid lists apply in both.
  const [mode, setMode] = useState<"rankings" | "tiers" | "projections">("rankings");
  const ranks = useCuratedRanks();
  // Hides lineup changes whose net projection goes DOWN (a ranking or priority
  // is being followed at a projected cost). Off by default so nothing is
  // hidden without you choosing it.
  const [hideLosing, setHideLosing] = useState(false);
  // Keeps a real Thu/Fri/Sat RB/WR out of FLEX (that slot is only ever filled
  // by a Sun/Mon player) and, among close calls, prefers starting the
  // earlier-locking player in his own slot first — Thu > Fri > Sat > Sun >
  // Mon. On by default per the roster-lock strategy this exists for; off
  // reverts to a pure points/rank optimizer with no day awareness, to
  // compare side by side.
  const [lockEarlyFlex, setLockEarlyFlex] = useState(true);
  // For weeks AFTER the current one, a player listed Out/COV today is assumed to be back (only IR/PUP/Sus/NA/DNR keep him
  // out) — otherwise one short injury would bench him for the whole rest of the season. Visible, and switchable.
  const [futureHealthy, setFutureHealthy] = useState(true);
  // The one-click "set the rest of the season" flow: after the lineups are computed, open the single confirm automatically.
  const [autoConfirm, setAutoConfirm] = useState(false);
  const isOutStatus = (week: number, inj: string | null | undefined) =>
    !!inj && (week > currentWeek && futureHealthy ? LONG_TERM_OUT.has(inj) : OUT_STATUSES.has(inj));
  const unavailableForWeek = (week: number, id: string) => {
    const e = pmap?.[id];
    if (!e) return true;
    if (week === currentWeek && doubts.has(id)) return true;
    if (isOutStatus(week, e.inj)) return true;
    return !!e.t && BYE_WEEKS_2026[e.t] === week;
  };
  const ranksPending = mode !== "projections" && !ranks;
  const allWeeksLoading = weeksToShow.some((w) => !(w in weekData));

  // "Your call" answers for this run: when the optimizer starts a player you rank BELOW a bench player, you pick who you
  // prefer. Keyed "inId>benchId" (same two players decide every league at once); value = who you chose.
  const [calls, setCalls] = useState<Record<string, string>>({});
  // Players YOU think won't play this week (usually Questionable/Doubtful): treated as unavailable for the current week, so the
  // optimizer picks the best replacement from your rankings + Sleeper projections. Per-run only.
  const [doubts, setDoubts] = useState<Set<string>>(new Set());
  const toggleDoubt = (id: string) =>
    setDoubts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // For a "won't play" player you can also pick the replacement yourself (otherwise the optimizer's recommendation is used).
  const [replaceWith, setReplaceWith] = useState<Record<string, string>>({});
  const forcedStart = useMemo(() => {
    const m = new Set<string>();
    for (const [d, rid] of Object.entries(replaceWith)) if (rid && doubts.has(d)) m.add(rid);
    for (const [k, winner] of Object.entries(calls)) {
      const [inId, benchId] = k.split(">");
      if (winner === benchId) m.add(benchId);
      else if (winner === inId) m.add(inId);
    }
    return m;
  }, [calls, replaceWith, doubts]);
  const priorityIndex = useMemo(() => new Map(prefs.priority.map((id, i) => [id, i])), [prefs.priority]);
  const avoidSet = useMemo(() => new Set(prefs.avoid), [prefs.avoid]);
  const flexFirstIndex = useMemo(() => new Map(prefs.flexFirst.map((id, i) => [id, i])), [prefs.flexFirst]);
  const neverStartSet = useMemo(() => new Set(prefs.neverStart), [prefs.neverStart]);

  const { rows, lockedCount, unavailableCount } = useMemo(() => {
    const out: Row[] = [];
    let locked = 0;
    let unavailable = 0;
    if (!pmap || allWeeksLoading || ranksPending) return { rows: out, lockedCount: 0, unavailableCount: 0 };

    for (const week of weeksToShow) {
      const wd = weekData[week];
      if (!wd) continue;
      const { proj, kickoffs, loadedAt } = wd;
      const isUnavailable = (id: string) => {
        const e = pmap[id];
        if (!e) return true;
        if (week === currentWeek && doubts.has(id)) return true;
        if (e.inj && (week > currentWeek && futureHealthy ? LONG_TERM_OUT.has(e.inj) : OUT_STATUSES.has(e.inj))) return true;
        return !!e.t && BYE_WEEKS_2026[e.t] === week;
      };
      const isLocked = (id: string) => {
        const team = pmap[id]?.t;
        const ko = team ? kickoffs[team] : undefined;
        return !!ko && Date.parse(ko) <= loadedAt;
      };
      const gameDay = (id: string) => {
        const team = pmap[id]?.t;
        return dayOfWeek(team ? kickoffs[team] : undefined);
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
          priorityRank: (id) => (forcedStart.has(id) ? 0 : priorityIndex.get(id)),
          avoid: (id) => avoidSet.has(id),
          neverStart: (id) => neverStartSet.has(id),
          flexFirst: (id) => flexFirstIndex.get(id),
          // "rankings" = your exact list order; "tiers" = only your TIER decides, so players in the same tier are split by
          // projection (a tier step is 100 positions, far larger than any projection gap, so tiers never cross).
          rankOrder:
            mode === "rankings"
              ? (id) => ranks?.get(id)?.order
              : mode === "tiers"
                ? (id) => {
                    const t = ranks?.get(id)?.tier;
                    return t ? (t - 1) * 100 : undefined;
                  }
                : undefined,
          gameDay: lockEarlyFlex ? gameDay : undefined,
        });
        for (const id of candidates) {
          if (isLocked(id)) locked += 1;
          else if (isUnavailable(id)) unavailable += 1;
        }
        // A change can come from a preference even when it costs projected
        // points, so key on "is there a change", not on positive gain.
        if (result.changes.length > 0 && !(hideLosing && result.gain < -0.05)) {
          out.push({ key: `${l.league.id}:${week}`, week, leagueId: l.league.id, leagueName: l.league.name, rosterId: l.roster.rosterId, slotCodes, scoring: key, result });
        }
      }
    }
    out.sort((a, b) => a.week - b.week || b.result.gain - a.result.gain);
    return { rows: out, lockedCount: locked, unavailableCount: unavailable };
  }, [leagues, pmap, weekData, weeksToShow, allWeeksLoading, doubts, forcedStart, priorityIndex, avoidSet, neverStartSet, flexFirstIndex, mode, ranks, ranksPending, hideLosing, lockEarlyFlex, futureHealthy, currentWeek]);

  // Players the optimizer starts although you rank someone at the same position HIGHER who sits (and is healthy). Grouped by the
  // pair so one answer settles every league; skipped once answered.
  const conflicts = useMemo(() => {
    if (!pmap || !ranks || mode === "rankings") return [];
    const better = (a: string, b: string) => {
      const ra = ranks.get(a), rb = ranks.get(b);
      if (!ra) return false;
      if (!rb) return true;
      return mode === "tiers" ? ra.tier < rb.tier : ra.order < rb.order;
    };
    const groups = new Map<string, { inId: string; benchId: string; leagues: Set<string>; weeks: Set<number> }>();
    for (const r of rows) {
      const lg = leagues.find((l) => l.league.id === r.leagueId);
      if (!lg?.roster) continue;
      const wd = weekData[r.week];
      if (!wd) continue;
      const starting = new Set(r.result.starters);
      const bench = lg.roster.players.filter((id) => !lg.roster!.reserve.includes(id) && !starting.has(id));
      for (const c of r.result.changes) {
        if (!c.in) continue;
        for (const b of bench) {
          if (pmap[b]?.p !== pmap[c.in]?.p) continue;
          if (neverStartSet.has(b) || avoidSet.has(b) || priorityIndex.has(c.in)) continue;
          if (unavailableForWeek(r.week, b)) continue;
          // A player whose game has started or finished is already decided — never ask about him (or the player he'd replace).
          const started = (id: string) => {
            const t = pmap[id]?.t;
            const ko = t ? wd.kickoffs[t] : undefined;
            return !!ko && Date.parse(ko) <= Math.max(Date.now(), wd.loadedAt);
          };
          if (started(b) || started(c.in)) continue;
          if (!better(b, c.in)) continue;
          const key = c.in + ">" + b;
          if (key in calls) continue;
          const g = groups.get(key) ?? { inId: c.in, benchId: b, leagues: new Set<string>(), weeks: new Set<number>() };
          g.leagues.add(r.leagueId);
          g.weeks.add(r.week);
          groups.set(key, g);
        }
      }
    }
    return [...groups.entries()].map(([key, g]) => ({ key, ...g })).sort((a, b) => b.leagues.size - a.leagues.size).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, ranks, mode, pmap, leagues, weekData, calls, neverStartSet, avoidSet, priorityIndex, futureHealthy]);

  // The Questionable/Doubtful board: every such player on your rosters (current week, game not started), how many leagues start him, and —
  // once you mark him "won't play" — who the optimizer starts in his place and in how many leagues.
  const doubtBoard = useMemo(() => {
    const wd = weekData[currentWeek];
    if (!pmap || !wd) return [];
    const info = new Map<string, { id: string; leagues: number; starting: number }>();
    for (const l of leagues) {
      if (!l.roster) continue;
      for (const id of l.roster.players) {
        if (l.roster.reserve.includes(id)) continue;
        const inj = pmap[id]?.inj;
        if (!(inj === "Questionable" || inj === "Doubtful" || doubts.has(id))) continue;
        const t = pmap[id]?.t;
        const ko = t ? wd.kickoffs[t] : undefined;
        if (ko && Date.parse(ko) <= Math.max(Date.now(), wd.loadedAt)) continue;
        if (t && BYE_WEEKS_2026[t] === currentWeek) continue;
        const e = info.get(id) ?? { id, leagues: 0, starting: 0 };
        e.leagues += 1;
        if (l.roster.starters.includes(id)) e.starting += 1;
        info.set(id, e);
      }
    }
    return [...info.values()].filter((e) => e.starting > 0 || doubts.has(e.id)).sort((a, b) => b.starting - a.starting).slice(0, 40);
  }, [leagues, pmap, weekData, currentWeek, doubts]);
  // Candidate replacements for each doubted player: healthy bench players at his position across the leagues that start him.
  const replacementOptions = useMemo(() => {
    const out = new Map<string, { id: string; n: number }[]>();
    if (!pmap) return out;
    for (const d of doubtBoard) {
      const tally = new Map<string, number>();
      for (const l of leagues) {
        if (!l.roster || !l.roster.starters.includes(d.id)) continue;
        for (const id of l.roster.players) {
          if (id === d.id || l.roster.reserve.includes(id) || l.roster.starters.includes(id)) continue;
          if (pmap[id]?.p !== pmap[d.id]?.p) continue;
          if (neverStartSet.has(id) || doubts.has(id) || unavailableForWeek(currentWeek, id)) continue;
          tally.set(id, (tally.get(id) ?? 0) + 1);
        }
      }
      const rankOf = (id: string) => ranks?.get(id)?.order ?? 9999;
      out.set(d.id, [...tally.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => rankOf(a.id) - rankOf(b.id) || b.n - a.n).slice(0, 10));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doubtBoard, leagues, pmap, ranks, neverStartSet, doubts]);
  const replacementsFor = (id: string) => {
    const tally = new Map<string, number>();
    let empty = 0;
    for (const r of rows) {
      if (r.week !== currentWeek) continue;
      for (const c of r.result.changes) {
        if (c.out !== id) continue;
        if (c.in) tally.set(c.in, (tally.get(c.in) ?? 0) + 1);
        else empty += 1;
      }
    }
    return { list: [...tally.entries()].sort((a, b) => b[1] - a[1]), empty };
  };

  // ── Manual lineup edits: "put THIS player in my FLEX" ──
  // The optimizer proposes; any unlocked slot can be overridden from a dropdown, and every pick is checked by
  // lib/lineupEdit.ts (healthy, not locked, not never-start, position-eligible, swap-legal). Edits are keyed by
  // row and discarded when the mode / week / FLEX-lock setting changes, since the proposal underneath changed.
  const leagueById = useMemo(() => new Map(leagues.map((l) => [l.league.id, l])), [leagues]);
  const editSig = `${mode}|${lockEarlyFlex}|${selectedWeek}|${futureHealthy}`;
  const [edits, setEdits] = useState<{ sig: string; byKey: Record<string, { starters: string[]; roster: string }> }>({ sig: "", byKey: {} });
  const rosterSigOf = (leagueId: string) => {
    const ro = leagueById.get(leagueId)?.roster;
    return ro ? [...ro.players].sort().join(",") + "|" + [...ro.reserve].sort().join(",") + "|" + ro.starters.join(",") : "";
  };
  // An edit is only valid for the roster it was made on: if a live reload changed the roster, it is dropped.
  const editsByKey = edits.sig === editSig ? edits.byKey : {};
  const [openEdit, setOpenEdit] = useState<Set<string>>(new Set());
  const unavailableFor = (week: number, id: string) => {
    const e = pmap?.[id];
    if (!e) return true;
    if (week === currentWeek && doubts.has(id)) return true;
    if (isOutStatus(week, e.inj)) return true;
    return !!e.t && BYE_WEEKS_2026[e.t] === week;
  };
  const lockedFor = (week: number, id: string) => {
    const wd = weekData[week];
    const team = pmap?.[id]?.t;
    const ko = team && wd ? wd.kickoffs[team] : undefined;
    return !!ko && !!wd && Date.parse(ko) <= wd.loadedAt;
  };
  const ctxFor = (r: Row): EditCtx | null => {
    const l = leagueById.get(r.leagueId);
    if (!l?.roster || !pmap) return null;
    const reserve = new Set(l.roster.reserve);
    return {
      slotCodes: r.slotCodes,
      candidates: l.roster.players.filter((id) => !reserve.has(id)),
      posOf: (id) => pmap[id]?.p ?? null,
      unavailable: (id) => unavailableFor(r.week, id),
      locked: (id) => lockedFor(r.week, id),
      neverStart: (id) => neverStartSet.has(id),
    };
  };
  // What will actually be sent for a row: the optimizer's lineup, or the owner's hand-edited one.
  const view = (r: Row) => {
    const edit = editsByKey[r.key];
    const starters = edit && edit.roster === rosterSigOf(r.leagueId) ? edit.starters : undefined;
    if (!starters) {
      return { starters: r.result.starters, changes: r.result.changes, currentPoints: r.result.currentPoints, optimalPoints: r.result.optimalPoints, gain: r.result.gain, edited: false };
    }
    const current = leagueById.get(r.leagueId)?.roster?.starters ?? [];
    const pts = (ids: string[]) =>
      ids.slice(0, r.slotCodes.length).reduce(
        (sum, id) => sum + (!id || id === "0" || unavailableFor(r.week, id) ? 0 : weekData[r.week]?.proj[id]?.[r.scoring] ?? 0),
        0
      );
    const cur = pts(current);
    const opt = pts(starters);
    return { starters, changes: diffLineups(r.slotCodes, current, starters), currentPoints: cur, optimalPoints: opt, gain: opt - cur, edited: true };
  };
  const pickSlot = (r: Row, slotIdx: number, id: string) => {
    const ctx = ctxFor(r);
    if (!ctx) return;
    const next = applyPick(ctx, view(r).starters, slotIdx, id);
    if (next) setEdits({ sig: editSig, byKey: { ...editsByKey, [r.key]: { starters: next, roster: rosterSigOf(r.leagueId) } } });
  };
  const resetEdit = (r: Row) => {
    const rest = { ...editsByKey };
    delete rest[r.key];
    setEdits({ sig: editSig, byKey: rest });
  };

  const finished = (r: Row) => status[r.key]?.kind === "done";
  const selectedRows = rows.filter((r) => !deselected.has(r.key) && !finished(r) && view(r).changes.length > 0);
  const totalGain = rows.reduce((s, r) => s + view(r).gain, 0);
  // The one-click flow opens the confirm by itself as soon as the lineups are ready.
  const aheadReady = !allWeeksLoading && !ranksPending;
  const showConfirm = (confirming || autoConfirm) && !running && aheadReady && selectedRows.length > 0;
  const runAhead = () => {
    // Highest Sleeper projection each week, FLEX never holding a Thu–Sat game (hard rule), early-Sunday games leaning to
    // true slots and later Sunday / Monday leaning to FLEX (tie-breaks only). Your Priority / Avoid / Never-start lists
    // still apply; nothing is sent until you confirm the summary.
    setMode("projections");
    setLockEarlyFlex(true);
    setHideLosing(false);
    setDeselected(new Set());
    setSelectedWeek("ahead");
    setAutoConfirm(true);
  };
  const name = (id: string | null) => (id ? pmap?.[id]?.n ?? id : "empty");
  const flag = (id: string | null) => {
    if (!id) return "";
    const inj = pmap?.[id]?.inj;
    const health = inj === "Questionable" ? " (Q)" : inj === "Doubtful" ? " (D)" : "";
    return `${priorityIndex.has(id) ? " ★" : neverStartSet.has(id) ? " ⛔" : avoidSet.has(id) ? " ⊘" : flexFirstIndex.has(id) ? " ⇄" : ""}${health}`;
  };
  // Show both sides of every swap with the numbers behind it (your ranking
  // and Sleeper's projection), so it's clear why each move is proposed.
  const rankLabel = (id: string) => {
    const rk = ranks?.get(id);
    return rk ? `#${rk.order + 1}` : "unranked";
  };
  const who = (r: Row, id: string | null) =>
    id ? `${name(id)}${flag(id)} (${rankLabel(id)} · ${(weekData[r.week]?.proj[id]?.[r.scoring] ?? 0).toFixed(1)})` : "empty";
  const reason = (r: Row, c: { out: string | null; in: string | null }) => {
    if (c.in && priorityIndex.has(c.in)) return "your priority";
    if (c.out && neverStartSet.has(c.out)) return "never start";
    if (c.out && avoidSet.has(c.out)) return "avoid list";
    const outInj = c.out ? pmap?.[c.out]?.inj : null;
    const outTeam = c.out ? pmap?.[c.out]?.t : null;
    if (c.out && ((outInj && OUT_STATUSES.has(outInj)) || (outTeam && BYE_WEEKS_2026[outTeam] === r.week))) {
      return "replacing an unavailable player";
    }
    if (mode === "tiers" && c.in) {
      const ti = ranks?.get(c.in)?.tier;
      const to = c.out ? ranks?.get(c.out)?.tier : undefined;
      if (ti !== undefined && (to === undefined || ti < to)) return "better tier";
      return "same tier — higher projection";
    }
    if (mode === "rankings" && c.in) {
      const ri = ranks?.get(c.in)?.order;
      const ro = c.out ? ranks?.get(c.out)?.order : undefined;
      if (ri !== undefined && (ro === undefined || ri < ro)) return "ranked higher";
    }
    return "higher projection";
  };
  const swapText = (r: Row) =>
    view(r).changes.map((c, _i, all) => {
      // A player who leaves one slot and shows up in another is a slot shuffle (e.g. RB ↔ FLEX), not a bench/start change.
      const moved = !!c.in && all.some((o) => o.out === c.in);
      const why = view(r).edited ? "your pick" : moved ? "slot move — he's still starting, just in a different slot (kickoff-day / FLEX preference)" : reason(r, c);
      return `${c.slotCode}: ${who(r, c.out)} → ${who(r, c.in)} — ${why}`;
    });

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
    setAutoConfirm(false);
    setRunning(true);
    setSummary("");
    abortRef.current = { aborted: false };
    // Pre-flight: before anything is sent, re-read every affected roster from Sleeper and set aside any league that changed
    // since the proposal was built (a drop, add, IR move, or a lineup edit made in the Sleeper app) — one check per league.
    // Only the CURRENT week's lineup depends on the current starters; future-week lineups just need the same players.
    setSummary("");
    setStatus({});
    const pre = await preflightRosters(
      selectedRows.map((r) => {
        const b = leagueById.get(r.leagueId)?.roster;
        return {
          leagueId: r.leagueId,
          rosterId: r.rosterId,
          base: b ? { starters: b.starters, players: b.players, reserve: b.reserve } : null,
          strictStarters: r.week === currentWeek,
        };
      })
    );
    setSummary("");
    const tasks: BulkTask[] = selectedRows.map((r) => ({
      key: r.key,
      run: async () => {
        const p = pre[r.leagueId];
        let starters = view(r).starters;
        let note = "";
        if (p?.blocked) {
          // Later weeks don't depend on this week's lineup: if the roster changed (a drop / add / IR move), still send what we
          // can — any player who is no longer active on the roster is left out of his slot instead of skipping the whole league.
          if (r.week > currentWeek && p.fresh) {
            const active = new Set(p.fresh.players.filter((id) => !p.fresh!.reserve.includes(id)));
            let removed = 0;
            starters = starters.map((id) => (id && id !== "0" && !active.has(id) ? (removed++, "0") : id));
            if (removed > 0) note = `, ${removed} slot${removed === 1 ? "" : "s"} left empty (player no longer on roster)`;
          } else throw new Error(p.blocked);
        }
        await setStarters(token, {
          leagueId: r.leagueId,
          rosterId: r.rosterId,
          starters,
          week: r.week,
        });
        const n = view(r).changes.length;
        return `${n} swap${n === 1 ? "" : "s"}${note}`;
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
    // Re-sync just the leagues that changed so the Action Queue, banners and
    // rosters reflect it right away (keys are "leagueId" or "leagueId:playerId").
    const refreshed = result.done > 0 ? await refresh(doneKeys.map((k) => k.split(":")[0])) : null;
    setSummary(
      `${result.done} lineups set${result.failed ? `, ${result.failed} failed` : ""}${
        result.skipped ? `, ${result.skipped} skipped` : ""
      }.${result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : ""}` +
        (refreshed === null ? "" : refreshed ? " Fantis's data was refreshed for those leagues." : " Couldn't auto-refresh Fantis's data — press Refresh (top right).")
    );
  };

  // The per-league editor: every unlocked slot gets a dropdown of the players who can legally go there, each shown
  // with tier · projection (· THU/FRI/SAT when his game locks early) so tier-mates are easy to tell apart.
  const renderEditor = (r: Row) => {
    const ctx = ctxFor(r);
    if (!ctx || finished(r)) return null;
    const v = view(r);
    const open = openEdit.has(r.key);
    const projOf = (id: string) => weekData[r.week]?.proj[id]?.[r.scoring] ?? 0;
    const optionLabel = (id: string) => {
      const rk = ranks?.get(id);
      const tierTxt = rk ? `Tier ${TIER_LABELS[rk.tier - 1] ?? rk.tier}` : "unranked";
      const day = dayOfWeek(weekData[r.week]?.kickoffs[pmap?.[id]?.t ?? ""]);
      const dayTxt = day ? ` · ${kickoffSlotLabel(day)}` : "";
      return `${name(id)}${flag(id)} · ${tierTxt} · ${projOf(id).toFixed(1)}${dayTxt}`;
    };
    const tierRank = (id: string) => ranks?.get(id)?.tier ?? 99;
    return (
      <span style={{ display: "block", marginTop: 4, fontWeight: 400 }}>
        <button
          type="button"
          className="linklike"
          style={{ fontSize: 12.5 }}
          onClick={() =>
            setOpenEdit((prev) => {
              const next = new Set(prev);
              if (next.has(r.key)) next.delete(r.key);
              else next.add(r.key);
              return next;
            })
          }
        >
          {open ? "Hide lineup ▴" : "Choose players ▾"}
        </button>
        {v.edited && (
          <>
            <span className="portmeta" style={{ color: "var(--amber)", marginLeft: 8 }}>edited by you</span>{" "}
            <button type="button" className="linklike" style={{ fontSize: 12.5 }} onClick={() => resetEdit(r)}>
              Reset
            </button>
          </>
        )}
        {open && (
          <span style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {r.slotCodes.map((code, i) => {
              const cur = v.starters[i];
              const locked = slotLocked(ctx, v.starters, i);
              const opts = slotOptions(ctx, v.starters, i).sort((a, b) => tierRank(a) - tierRank(b) || projOf(b) - projOf(a));
              return (
                <label key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="portmeta" style={{ width: 52, flex: "none" }}>{code}</span>
                  {locked ? (
                    <span className="portmeta">{name(cur)} — game started, locked</span>
                  ) : (
                    <select
                      className="select sm"
                      style={{ flex: 1, minWidth: 0 }}
                      value={cur && cur !== "0" ? cur : "0"}
                      disabled={running}
                      onChange={(e) => pickSlot(r, i, e.target.value)}
                    >
                      {(!cur || cur === "0") && <option value="0">(empty)</option>}
                      {opts.map((id) => (
                        <option key={id} value={id}>
                          {optionLabel(id)}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              );
            })}
          </span>
        )}
      </span>
    );
  };

  if (!pmap) return <p className="hint">Loading players…</p>;
  if (loadError) {
    return (
      <p className="hint" style={{ color: "var(--red)" }}>
        {loadError}{" "}
        <button className="linklike" onClick={reload}>Retry</button>
      </p>
    );
  }

  const weekLabel =
    selectedWeek === "all" ? `weeks ${currentWeek}–${LAST_WEEK}` : selectedWeek === "ahead" ? `weeks ${currentWeek + 1}–${AHEAD_LAST}` : `week ${selectedWeek}`;

  return (
    <>
      <div className="card sync" style={{ maxWidth: "none", margin: "0 0 14px", padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <b style={{ fontSize: 15 }}>Set weeks {currentWeek + 1}–{AHEAD_LAST} in one click</b>
            <p className="hint" style={{ margin: "4px 0 0" }}>
              Highest Sleeper projection each week. FLEX never holds a Thursday/Friday/Saturday game; early-Sunday (10 AM PT) players go in your RB/WR/TE
              slots, and later-Sunday / Monday players go in FLEX when it&rsquo;s a tie. Your Priority / Avoid / Never-start lists still apply. You&rsquo;ll see one summary
              to confirm, then it sends.
            </p>
          </div>
          <button className="btn" onClick={runAhead} disabled={!token || running || currentWeek >= AHEAD_LAST}>
            {autoConfirm && !aheadReady ? "Preparing…" : `Set weeks ${currentWeek + 1}–${AHEAD_LAST}`}
          </button>
        </div>
        {!token && <p className="hint" style={{ margin: "8px 0 0", color: "var(--red)" }}>Connect write access above first.</p>}
      </div>
      <div className="field" style={{ margin: "0 0 12px", alignItems: "center" }}>
        <span className="portmeta">Week</span>
        <select
          className="select sm"
          value={String(selectedWeek)}
          onChange={(e) => setSelectedWeek(e.target.value === "all" ? "all" : e.target.value === "ahead" ? "ahead" : Number(e.target.value))}
        >
          {Array.from({ length: LAST_WEEK - currentWeek + 1 }, (_, i) => currentWeek + i).map((w) => (
            <option key={w} value={w}>Week {w}{w === currentWeek ? " (current)" : ""}</option>
          ))}
          <option value="ahead">Weeks {currentWeek + 1}–{AHEAD_LAST} (set ahead)</option>
          <option value="all">All weeks ({currentWeek}–{LAST_WEEK})</option>
        </select>
        {selectedWeek !== currentWeek && (
          <button
            className={`chip-filter ${futureHealthy ? "on" : ""}`}
            onClick={() => setFutureHealthy((v) => !v)}
            title="A player listed Out today is probably not out for every later week. On: only IR/PUP/Sus/NA/DNR keep a player out of later weeks."
          >
            {futureHealthy ? "Later weeks: Out/Doubtful count as healthy" : "Later weeks: Out players stay benched"}
          </button>
        )}
        <button
          className={`chip-filter ${lockEarlyFlex ? "on" : ""}`}
          onClick={() => setLockEarlyFlex((v) => !v)}
          title="Thu/Fri/Sat RB/WR go in their own slot, never FLEX — FLEX is reserved for Sun/Mon, so it stays open as long as possible"
        >
          {lockEarlyFlex ? "Locking Thu–Sat starters out of FLEX" : "Not locking early starters out of FLEX"}
        </button>
      </div>
      {allWeeksLoading ? (
        <p className="hint">Loading {weekLabel}&rsquo;s projections…</p>
      ) : (
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
              ? "Starts your highest-ranked healthy players (your exact /admin order); anyone you haven't ranked is ordered by Sleeper's projection and sits below ranked players."
              : mode === "tiers"
                ? "Starts players from your best tiers first; when several players share a tier, the higher Sleeper projection decides. Anyone you haven't ranked sits below ranked players."
                : "Starts the highest Sleeper projection at each slot, ignoring your /admin rankings."}{" "}
            Want a different player (say, who takes FLEX)? Open <b>Choose players</b> on any league and pick — every option is checked against injuries, locked games and slot rules.{" "}
            Projections are Sleeper&rsquo;s {weekLabel} numbers for each league&rsquo;s PPR / half /
            standard scoring (custom scoring like TE premium is approximated). Players whose game has
            started are locked in place; injured (Out/IR) and bye-week players are skipped. Each swap
            shows (your rank · projection) for both players. (Q) / (D) = Questionable / Doubtful.
            {selectedWeek !== currentWeek && (
              <>
                {" "}A future week&rsquo;s roster, byes and projections can still change before it&rsquo;s
                actually played. One thing that WON&rsquo;T update automatically: injury status (Out/IR/
                Doubtful/etc.) is today&rsquo;s real designation, not a forecast — a player marked out
                right now may well be healthy again by {weekLabel}, and vice versa, so a big swing here can
                just mean this week&rsquo;s injury list doesn&rsquo;t apply yet. Re-check closer to kickoff.
              </>
            )}
          </p>
          <div className="field" style={{ margin: "0 0 12px", alignItems: "center" }}>
            <span className="portmeta">Choose by</span>
            <button
              className={`chip-filter ${mode === "tiers" ? "on" : ""}`}
              onClick={() => setMode("tiers")}
              title="Your tiers decide who's preferred; players in the same tier are split by projection"
            >
              My tiers, then projection
            </button>
            <button
              className={`chip-filter ${mode === "rankings" ? "on" : ""}`}
              onClick={() => setMode("rankings")}
              title="Your exact list order decides, even between players in the same tier"
            >
              My exact rankings
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
            {prefs.priority.length + prefs.avoid.length + prefs.neverStart.length > 0 ? (
              <>
                Following your player preferences ({prefs.priority.length} priority, {prefs.avoid.length}{" "}
                avoid, {prefs.neverStart.length} never start): ★ = priority, ⊘ = avoid, ⛔ = never start, ⇄ = flex first.{" "}
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
              {doubtBoard.length > 0 && (
                <div className="card" style={{ maxWidth: "none", margin: "0 0 12px", padding: "12px 14px" }}>
                  <b>Questionable board — week {currentWeek}</b>
                  <span className="portmeta" style={{ display: "block", marginBottom: 8 }}>
                    Players on your rosters listed Questionable/Doubtful whose game hasn&rsquo;t started. Press &ldquo;Mark: won&rsquo;t play&rdquo; for anyone you think is sitting:
                    he&rsquo;s treated as out this week and the best replacement from your rankings + Sleeper projections is started instead (shown here and in the
                    lineups below). Press it again to undo. Applies to this week only and isn&rsquo;t saved.
                  </span>
                  {doubtBoard.map((d) => {
                    const on = doubts.has(d.id);
                    const rep = on ? replacementsFor(d.id) : null;
                    const inj = pmap?.[d.id]?.inj;
                    const pr = weekData[currentWeek]?.proj[d.id];
                    return (
                      <div key={d.id} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line-soft)" }}>
                        <button
                          type="button"
                          className="chip-filter"
                          disabled={running}
                          aria-pressed={on}
                          onClick={() => toggleDoubt(d.id)}
                          style={{ minWidth: 150, fontWeight: 650, ...(on ? { background: "var(--red)", color: "#10131A", borderColor: "var(--red)" } : {}) }}
                        >
                          {on ? "✕ Won't play (undo)" : "Mark: won't play"}
                        </button>
                        <span style={{ flex: 1, minWidth: 240 }}>
                          <b>{name(d.id)}</b> ({inj ?? "—"}) · {pmap?.[d.id]?.p} {pmap?.[d.id]?.t} · {rankLabel(d.id)}
                          {ranks?.get(d.id) ? ` · tier ${ranks.get(d.id)!.tier}` : ""} · {(pr?.pts_ppr ?? 0).toFixed(1)} proj
                          <span className="portmeta" style={{ display: "block" }}>
                            starting in {d.starting} of {d.leagues} league{d.leagues === 1 ? "" : "s"}
                            {rep && (rep.list.length > 0 || rep.empty > 0) && (
                              <>
                                {" "}— replaced by:{" "}
                                {rep.list.map(([id, n]) => `${name(id)} (${rankLabel(id)} · ${(weekData[currentWeek]?.proj[id]?.pts_ppr ?? 0).toFixed(1)}) ×${n}`).join(", ")}
                                {rep.empty > 0 ? `, empty slot ×${rep.empty}` : ""}
                              </>
                            )}
                            {rep && rep.list.length === 0 && rep.empty === 0 && " — no lineup change needed"}
                          </span>
                        </span>
                        {on && (replacementOptions.get(d.id)?.length ?? 0) > 0 && (
                          <select
                            value={replaceWith[d.id] ?? ""}
                            disabled={running}
                            onChange={(e) => setReplaceWith((p) => ({ ...p, [d.id]: e.target.value }))}
                            style={{ maxWidth: 320 }}
                            aria-label={`Replacement for ${name(d.id)}`}
                          >
                            <option value="">Recommended — best per league</option>
                            {replacementOptions.get(d.id)!.map((o) => (
                              <option key={o.id} value={o.id}>
                                Start {name(o.id)} ({rankLabel(o.id)}
                                {ranks?.get(o.id) ? ` · tier ${ranks.get(o.id)!.tier}` : ""} · {(weekData[currentWeek]?.proj[o.id]?.pts_ppr ?? 0).toFixed(1)}) — on {o.n} bench{o.n === 1 ? "" : "es"}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {conflicts.length > 0 && (
                <div className="card" style={{ maxWidth: "none", margin: "0 0 12px", padding: "12px 14px" }}>
                  <b>Your call — {conflicts.length} player{conflicts.length === 1 ? "" : "s"} start over someone you rank higher</b>
                  <span className="portmeta" style={{ display: "block", marginBottom: 8 }}>
                    The projection picked the first player, but you rank the second one higher. Choose who you prefer — one answer applies to every league and
                    week shown, and the lineups below update. Not answering keeps the optimizer&rsquo;s pick.
                  </span>
                  {conflicts.map((c) => {
                    const line = (id: string) => `${name(id)} (${rankLabel(id)}${ranks?.get(id) ? ` · tier ${ranks.get(id)!.tier}` : ""})`;
                    return (
                      <div key={c.key} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--line-soft)" }}>
                        <span style={{ flex: 1, minWidth: 240 }}>
                          <b>{line(c.inId)}</b> starts over <b>{line(c.benchId)}</b>
                          <span className="portmeta" style={{ display: "block" }}>
                            in {c.leagues.size} league{c.leagues.size === 1 ? "" : "s"} · who do you prefer?
                          </span>
                        </span>
                        <button className="chip-filter" disabled={running} onClick={() => setCalls((p) => ({ ...p, [c.key]: c.inId }))}>
                          Keep {name(c.inId)}
                        </button>
                        <button className="chip-filter" disabled={running} onClick={() => setCalls((p) => ({ ...p, [c.key]: c.benchId }))}>
                          Start {name(c.benchId)}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
                <button className="chip-filter" onClick={() => setDeselected(new Set())}>Select all</button>
                <button className="chip-filter" onClick={() => setDeselected(new Set(rows.map((r) => r.key)))}>Select none</button>
                <button className="chip-filter" onClick={reload}>Reload</button>
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

              {showConfirm && (
                <BulkConfirm
                  title={`Set ${selectedRows.length} lineups (${selectedRows.reduce((s, r) => s + view(r).gain, 0) >= 0 ? "+" : ""}${selectedRows.reduce((s, r) => s + view(r).gain, 0).toFixed(1)} projected points)`}
                  lines={selectedRows.map((r) => (
                    <span key={r.key}>
                      {r.leagueName}: {swapText(r).join("; ")}
                    </span>
                  ))}
                  summary={
                    selectedWeek === "ahead" ? (
                      <>
                        {new Set(selectedRows.map((r) => r.leagueId)).size} leagues · {weekLabel} · highest Sleeper projection each week · FLEX never holds a
                        Thu/Fri/Sat game · early-Sunday (10 AM PT) players go in RB/WR/TE slots, later Sunday &amp; Monday players prefer FLEX · sent about 3 at a
                        time, so a big batch can take several minutes (a week Sleeper won&rsquo;t accept yet just shows as failed for that league).{" "}
                        {futureHealthy ? "Players listed Out/Doubtful today are treated as healthy for later weeks (IR stays benched)." : "Players listed Out today stay benched in every week."}
                        {(() => {
                          // The flex rule is absolute: if a roster has nobody eligible without a Thu–Sat game, the slot goes empty.
                          const empties = selectedRows.filter((r) => view(r).starters.slice(0, r.slotCodes.length).includes("0")).length;
                          return empties > 0 ? (
                            <b style={{ color: "var(--amber)", display: "block", marginTop: 4 }}>
                              ⚠ {empties} lineup{empties === 1 ? "" : "s"} leave a slot EMPTY because no eligible player there avoids a Thu/Fri/Sat game (or all are out/on bye). Open
                              Choose players on those rows to fill them by hand if you&rsquo;d rather.
                            </b>
                          ) : null;
                        })()}
                      </>
                    ) : undefined
                  }
                  confirmLabel={`Send ${selectedRows.length} lineups to Sleeper`}
                  onConfirm={start}
                  onCancel={() => {
                    setConfirming(false);
                    setAutoConfirm(false);
                  }}
                />
              )}
              {(running || (summary && Object.keys(status).length > 0)) && (() => {
                const sts = rows.map((r) => status[r.key]).filter(Boolean);
                const total = sts.length;
                if (total === 0) return null;
                const ok = sts.filter((x) => x.kind === "done").length;
                const bad = sts.filter((x) => x.kind === "failed").length;
                const doneAll = !running;
                return (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{ position: "fixed", right: 16, bottom: 16, zIndex: 60, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 16px", minWidth: 150, textAlign: "center" }}
                  >
                    <div style={{ fontSize: 28, fontWeight: 700, color: doneAll ? (bad ? "var(--amber)" : "var(--mint)") : "var(--amber)", fontVariantNumeric: "tabular-nums" }}>
                      {ok} / {total}
                    </div>
                    <div className="portmeta">{doneAll ? "lineups sent — finished" : "lineups sent — running"}</div>
                    {bad > 0 && <div className="portmeta" style={{ color: "var(--red)" }}>{bad} failed</div>}
                  </div>
                );
              })()}
              {running && (() => {
                const sts = rows.map((r) => status[r.key]).filter(Boolean);
                const total = sts.length;
                const ok = sts.filter((x) => x.kind === "done").length;
                const bad = sts.filter((x) => x.kind === "failed").length;
                const now = sts.filter((x) => x.kind === "running").length;
                const finishedN = ok + bad + sts.filter((x) => x.kind === "skipped").length;
                return (
                  <div className="card" style={{ maxWidth: "none", margin: "0 0 12px", padding: "10px 14px" }}>
                    <b style={{ color: "var(--amber)" }}>
                      {total === 0 ? "Starting… checking every roster against Sleeper first" : `Sending lineups to Sleeper… ${finishedN} of ${total} finished`}
                    </b>
                    {total > 0 && (
                      <span className="portmeta" style={{ display: "block" }}>
                        {ok} sent · {bad} failed · {now} in progress · {total - finishedN - now} waiting. Keep this tab open; press Abort to stop the rest.
                      </span>
                    )}
                    {total > 0 && (
                      <div style={{ height: 4, background: "var(--line)", borderRadius: 2, marginTop: 6 }}>
                        <div style={{ height: 4, width: `${Math.round((finishedN / total) * 100)}%`, background: "var(--amber)", borderRadius: 2 }} />
                      </div>
                    )}
                  </div>
                );
              })()}
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
                        {selectedWeek === "all" || selectedWeek === "ahead" ? `Week ${r.week} · ${r.leagueName}` : r.leagueName}
                        {swapText(r).map((t, i) => (
                          <span key={i} className="portmeta" style={{ display: "block", fontWeight: 400 }}>{t}</span>
                        ))}
                        {view(r).changes.length === 0 && (
                          <span className="portmeta" style={{ display: "block", fontWeight: 400 }}>No changes — matches what&rsquo;s on Sleeper now.</span>
                        )}
                        {renderEditor(r)}
                      </span>
                      <span className="portmeta" style={{ minWidth: 130 }}>
                        {view(r).currentPoints.toFixed(1)} → {view(r).optimalPoints.toFixed(1)}{" "}
                        <span style={{ color: view(r).gain < -0.05 ? "var(--amber)" : "var(--mint)" }}>
                          {view(r).gain >= 0 ? "+" : ""}{view(r).gain.toFixed(1)}
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
      )}
    </>
  );
}
