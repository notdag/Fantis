"use client";

import { useEffect, useMemo, useState } from "react";
import { getProjections } from "@/lib/sleeper";
import { scoringKey } from "@/lib/scoringKey";
import { findBenchedWatched } from "@/lib/topPlayersWatch";
import { buildStartingSlots } from "@/lib/rosterSlots";
import { BYE_WEEKS_2026 } from "@/lib/byeWeeks";
import { posChipStyle } from "@/lib/players";
import type { PlayerPrefs } from "@/lib/playerPrefs";
import type { PlayerMap, ProjectionMap } from "@/lib/types";
import type { LineupLeague } from "./LineupManager";
import { PlayerAvatar } from "./Avatar";
import { useCuratedRanks } from "./useCuratedRanks";

const OUT_STATUSES = new Set(["Out", "IR", "PUP", "Sus", "COV", "NA", "DNR"]);

// The heads-up notice at the top of Lineups: are any of my top-N ranked
// players (my /admin order) or priority-list players sitting on a bench while
// a worse-ranked player holds a spot they could fill? Injured / bye players
// on the bench are expected, so they're counted separately, not flagged.
export default function TopPlayersWatch({
  leagues,
  pmap,
  prefs,
  currentWeek,
  season,
  onFix,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  prefs: PlayerPrefs;
  currentWeek: number;
  season: string;
  onFix: () => void;
}) {
  const ranks = useCuratedRanks();
  // How many of each position count as "top" — by your /admin position rank.
  const [limits, setLimits] = useState<Record<string, number>>({ QB: 12, RB: 30, WR: 40, TE: 12 });
  const [open, setOpen] = useState(false);
  // When on, hides cases where the benched top player ranks higher but the
  // starter projects MORE than he does — a judgment call, not a clear miss.
  const [hideLower, setHideLower] = useState(false);

  // This week's Sleeper projections (cached for the day) so each case can show
  // both players' numbers. If they don't load, the notice still works — it just
  // can't tell the two kinds of case apart.
  const [proj, setProj] = useState<ProjectionMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    getProjections(season, currentWeek)
      .then((p) => {
        if (!cancelled) setProj(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [season, currentWeek]);

  const priorityIndex = useMemo(() => new Map(prefs.priority.map((id, i) => [id, i])), [prefs.priority]);

  const scoringByLeague = useMemo(
    () => new Map(leagues.map((l) => [l.league.id, scoringKey(l.league.settings)])),
    [leagues]
  );

  const rows = useMemo(() => {
    if (!pmap || !ranks) return null;
    const watchLeagues = leagues
      .filter((l) => l.roster && l.league.status === "in_season")
      .map((l) => ({
        leagueId: l.league.id,
        leagueName: l.league.name,
        slotCodes: buildStartingSlots(l.rosterPositions).map((s) => s.code),
        starters: l.roster!.starters,
        players: l.roster!.players,
        reserve: l.roster!.reserve,
      }));
    return findBenchedWatched(watchLeagues, {
      limits,
      posRankOf: (id) => ranks.get(id)?.posRank,
      rankOrder: (id) => ranks.get(id)?.order,
      priorityIndex: (id) => priorityIndex.get(id),
      posOf: (id) => pmap[id]?.p ?? null,
      points: proj
        ? (leagueId, id) => proj[id]?.[scoringByLeague.get(leagueId) ?? "pts_ppr"] ?? 0
        : undefined,
      unavailableReason: (id) => {
        const e = pmap[id];
        if (!e) return "unknown";
        if (e.inj && OUT_STATUSES.has(e.inj)) return e.inj;
        return e.t && BYE_WEEKS_2026[e.t] === currentWeek ? "bye week" : null;
      },
    });
  }, [leagues, pmap, ranks, limits, priorityIndex, currentWeek, proj, scoringByLeague]);

  if (!rows || !pmap) return null;

  const allProblems = rows.filter((r) => r.kind === "problem");
  const lowerCount = allProblems.filter((r) => r.lowerProj).length;
  const problems = hideLower ? allProblems.filter((r) => !r.lowerProj) : allProblems;
  const unavailable = rows.filter((r) => r.kind === "unavailable");
  const problemLeagues = new Set(problems.map((r) => r.leagueId)).size;
  const name = (id: string) => pmap[id]?.n ?? id;
  const rankText = (id: string) => {
    const o = ranks?.get(id)?.order;
    return o === undefined ? "unranked" : `#${o + 1}`;
  };

  const label = `QB ${limits.QB} · RB ${limits.RB} · WR ${limits.WR} · TE ${limits.TE}`;
  const topInput = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className="portmeta">top</span>
      {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
        <label key={pos} className="portmeta" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {pos}
          <input
            className="input"
            type="number"
            min={1}
            max={100}
            value={limits[pos]}
            onChange={(e) =>
              setLimits((prev) => ({ ...prev, [pos]: Math.min(100, Math.max(1, Number(e.target.value) || prev[pos])) }))
            }
            style={{ width: 54, flex: "none", minWidth: 0 }}
          />
        </label>
      ))}
    </span>
  );

  const hideToggle = (
    <button
      className={`chip-filter ${hideLower ? "on" : ""}`}
      onClick={() => setHideLower((v) => !v)}
      title="Hide cases where the benched player ranks higher but the starter projects more points"
    >
      {hideLower ? `Showing clear misses only (${lowerCount} hidden)` : `Hide lower-projection cases (${lowerCount})`}
    </button>
  );

  if (problems.length === 0) {
    return (
      <div className="card sync" style={{ marginBottom: 16 }}>
        <div className="field" style={{ alignItems: "center" }}>
          <span className="hint" style={{ margin: 0, color: "var(--mint)" }}>
            {hideLower && lowerCount > 0
              ? `✓ No clear misses among your top players (${label}) — ${lowerCount} lower-projection case${lowerCount === 1 ? " is" : "s are"} hidden.`
              : `✓ Every healthy top player you own (${label}) is starting wherever he can.`}
            {unavailable.length > 0 && ` (${unavailable.length} more are benched because they're injured or on bye.)`}
          </span>
          <span style={{ flex: 1 }} />
          {topInput}
          {lowerCount > 0 && hideToggle}
        </div>
      </div>
    );
  }

  return (
    <div className="card sync" style={{ marginBottom: 16, borderColor: "var(--amber)" }}>
      <div className="field" style={{ alignItems: "center" }}>
        <span className="hint" style={{ margin: 0, color: "var(--amber)", fontWeight: 600 }}>
          ⚠ {problems.length} of your top players ({label}) {problems.length === 1 ? "is" : "are"} on the bench in{" "}
          {problemLeagues} league{problemLeagues === 1 ? "" : "s"} while a lower-ranked player starts
        </span>
        <span style={{ flex: 1 }} />
        {topInput}
        {hideToggle}
        <button className="btn ghost sm" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"}</button>
        <button className="btn sm" onClick={onFix}>Fix in Optimize</button>
      </div>
      {unavailable.length > 0 && (
        <p className="portmeta" style={{ margin: "6px 0 0" }}>
          {unavailable.length} more top player{unavailable.length === 1 ? " is" : "s are"}{" "}
          benched because they&rsquo;re injured or on bye — not counted.
        </p>
      )}
      {open && (
        <div style={{ marginTop: 12, maxHeight: "72vh", overflowY: "auto" }}>
          {problems.map((r) => (
            <div
              key={r.key}
              className="mgrrow static"
              style={{ height: "auto", minHeight: 56, flexWrap: "wrap", rowGap: 4, columnGap: 12, padding: "10px 12px" }}
            >
              <PlayerAvatar playerId={r.playerId} pos={pmap[r.playerId]?.p} size={28} />
              <span
                className="tname"
                style={{ flex: "1 1 220px", minWidth: 0, whiteSpace: "normal", overflow: "visible", textOverflow: "clip" }}
              >
                {name(r.playerId)} <span className="portmeta">{r.priority ? "★ priority" : rankText(r.playerId)}</span>
                <span className="portmeta" style={{ display: "block", fontWeight: 400, whiteSpace: "normal" }}>{r.leagueName}</span>
              </span>
              {pmap[r.playerId]?.p && <span className="pos" style={posChipStyle(pmap[r.playerId].p)}>{pmap[r.playerId].p}</span>}
              <span className="portmeta" style={{ flex: "1 1 260px", minWidth: 0, whiteSpace: "normal", color: "var(--bone)" }}>
                {r.displaces
                  ? `${name(r.displaces)} (${rankText(r.displaces)}${r.displacedProj != null ? ` · ${r.displacedProj.toFixed(1)} proj` : ""}) is starting in his spot`
                  : "an eligible slot is empty"}
                {r.proj != null && r.displaces && (
                  <span style={{ color: r.lowerProj ? "var(--amber)" : "var(--mint)" }}>
                    {" "}· he projects {r.proj.toFixed(1)}{r.lowerProj ? " (lower)" : " (higher)"}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
