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

// Real kickoff day of week, from the same ISO kickoff time used for lock
// checks — not a guess. Tue/Wed (no real NFL games) fall through to
// undefined, same as a missing kickoff.
function dayOfWeek(iso: string | undefined): "THU" | "FRI" | "SAT" | "SUN" | "MON" | undefined {
  if (!iso) return undefined;
  switch (new Date(iso).getDay()) {
    case 0: return "SUN";
    case 1: return "MON";
    case 4: return "THU";
    case 5: return "FRI";
    case 6: return "SAT";
    default: return undefined;
  }
}

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
  const [selectedWeek, setSelectedWeek] = useState<number | "all">(currentWeek);
  const weeksToShow = useMemo(
    () => (selectedWeek === "all" ? Array.from({ length: Math.max(0, LAST_WEEK - currentWeek + 1) }, (_, i) => currentWeek + i) : [selectedWeek]),
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
  const ranksPending = mode !== "projections" && !ranks;
  const allWeeksLoading = weeksToShow.some((w) => !(w in weekData));

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
        if (e.inj && OUT_STATUSES.has(e.inj)) return true;
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
          priorityRank: (id) => priorityIndex.get(id),
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
  }, [leagues, pmap, weekData, weeksToShow, allWeeksLoading, priorityIndex, avoidSet, neverStartSet, flexFirstIndex, mode, ranks, ranksPending, hideLosing, lockEarlyFlex]);

  // ── Manual lineup edits: "put THIS player in my FLEX" ──
  // The optimizer proposes; any unlocked slot can be overridden from a dropdown, and every pick is checked by
  // lib/lineupEdit.ts (healthy, not locked, not never-start, position-eligible, swap-legal). Edits are keyed by
  // row and discarded when the mode / week / FLEX-lock setting changes, since the proposal underneath changed.
  const leagueById = useMemo(() => new Map(leagues.map((l) => [l.league.id, l])), [leagues]);
  const editSig = `${mode}|${lockEarlyFlex}|${selectedWeek}`;
  const [edits, setEdits] = useState<{ sig: string; byKey: Record<string, string[]> }>({ sig: "", byKey: {} });
  const editsByKey = edits.sig === editSig ? edits.byKey : {};
  const [openEdit, setOpenEdit] = useState<Set<string>>(new Set());
  const unavailableFor = (week: number, id: string) => {
    const e = pmap?.[id];
    if (!e) return true;
    if (e.inj && OUT_STATUSES.has(e.inj)) return true;
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
    const starters = editsByKey[r.key];
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
    if (next) setEdits({ sig: editSig, byKey: { ...editsByKey, [r.key]: next } });
  };
  const resetEdit = (r: Row) => {
    const rest = { ...editsByKey };
    delete rest[r.key];
    setEdits({ sig: editSig, byKey: rest });
  };

  const finished = (r: Row) => status[r.key]?.kind === "done";
  const selectedRows = rows.filter((r) => !deselected.has(r.key) && !finished(r) && view(r).changes.length > 0);
  const totalGain = rows.reduce((s, r) => s + view(r).gain, 0);
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
    view(r).changes.map((c) => `${c.slotCode}: ${who(r, c.out)} → ${who(r, c.in)} — ${view(r).edited ? "your pick" : reason(r, c)}`);

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
    // Pre-flight: before anything is sent, re-read every affected roster from Sleeper and set aside any league that changed
    // since the proposal was built (a drop, add, IR move, or a lineup edit made in the Sleeper app) — one check per league.
    // Only the CURRENT week's lineup depends on the current starters; future-week lineups just need the same players.
    setSummary("Checking every roster against Sleeper first…");
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
        const blocked = pre[r.leagueId]?.blocked;
        if (blocked) throw new Error(blocked);
        await setStarters(token, {
          leagueId: r.leagueId,
          rosterId: r.rosterId,
          starters: view(r).starters,
          week: r.week,
        });
        const n = view(r).changes.length;
        return `${n} swap${n === 1 ? "" : "s"}`;
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
      const dayTxt = day === "THU" || day === "FRI" || day === "SAT" ? ` · ${day}` : "";
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

  const weekLabel = selectedWeek === "all" ? `weeks ${currentWeek}–${LAST_WEEK}` : `week ${selectedWeek}`;

  return (
    <>
      <div className="field" style={{ margin: "0 0 12px", alignItems: "center" }}>
        <span className="portmeta">Week</span>
        <select
          className="select sm"
          value={String(selectedWeek)}
          onChange={(e) => setSelectedWeek(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          {Array.from({ length: LAST_WEEK - currentWeek + 1 }, (_, i) => currentWeek + i).map((w) => (
            <option key={w} value={w}>Week {w}{w === currentWeek ? " (current)" : ""}</option>
          ))}
          <option value="all">All weeks ({currentWeek}–{LAST_WEEK})</option>
        </select>
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

              {confirming && (
                <BulkConfirm
                  title={`Set ${selectedRows.length} lineups (${selectedRows.reduce((s, r) => s + view(r).gain, 0) >= 0 ? "+" : ""}${selectedRows.reduce((s, r) => s + view(r).gain, 0).toFixed(1)} projected points)`}
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
                        {selectedWeek === "all" ? `Week ${r.week} · ${r.leagueName}` : r.leagueName}
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
