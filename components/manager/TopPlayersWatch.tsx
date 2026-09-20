"use client";

import { useMemo, useState } from "react";
import { findBenchedWatched } from "@/lib/topPlayersWatch";
import { buildStartingSlots } from "@/lib/rosterSlots";
import { BYE_WEEKS_2026 } from "@/lib/byeWeeks";
import { posChipStyle } from "@/lib/players";
import type { PlayerPrefs } from "@/lib/playerPrefs";
import type { PlayerMap } from "@/lib/types";
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
  onFix,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  prefs: PlayerPrefs;
  currentWeek: number;
  onFix: () => void;
}) {
  const ranks = useCuratedRanks();
  const [topN, setTopN] = useState(60);
  const [open, setOpen] = useState(false);

  const priorityIndex = useMemo(() => new Map(prefs.priority.map((id, i) => [id, i])), [prefs.priority]);

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
      topN,
      rankOrder: (id) => ranks.get(id)?.order,
      priorityIndex: (id) => priorityIndex.get(id),
      posOf: (id) => pmap[id]?.p ?? null,
      unavailableReason: (id) => {
        const e = pmap[id];
        if (!e) return "unknown";
        if (e.inj && OUT_STATUSES.has(e.inj)) return e.inj;
        return e.t && BYE_WEEKS_2026[e.t] === currentWeek ? "bye week" : null;
      },
    });
  }, [leagues, pmap, ranks, topN, priorityIndex, currentWeek]);

  if (!rows || !pmap) return null;

  const problems = rows.filter((r) => r.kind === "problem");
  const unavailable = rows.filter((r) => r.kind === "unavailable");
  const problemLeagues = new Set(problems.map((r) => r.leagueId)).size;
  const name = (id: string) => pmap[id]?.n ?? id;
  const rankText = (id: string) => {
    const o = ranks?.get(id)?.order;
    return o === undefined ? "unranked" : `#${o + 1}`;
  };

  const topInput = (
    <label className="portmeta" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      top
      <input
        className="input"
        type="number"
        min={5}
        max={300}
        value={topN}
        onChange={(e) => setTopN(Math.min(300, Math.max(5, Number(e.target.value) || 60)))}
        style={{ width: 64 }}
      />
    </label>
  );

  if (problems.length === 0) {
    return (
      <div className="card sync" style={{ marginBottom: 16 }}>
        <div className="field" style={{ alignItems: "center" }}>
          <span className="hint" style={{ margin: 0, color: "var(--mint)" }}>
            ✓ Every healthy top-{topN} player you own is starting wherever he can.
            {unavailable.length > 0 && ` (${unavailable.length} more are benched because they're injured or on bye.)`}
          </span>
          <span style={{ flex: 1 }} />
          {topInput}
        </div>
      </div>
    );
  }

  return (
    <div className="card sync" style={{ marginBottom: 16, borderColor: "var(--amber)" }}>
      <div className="field" style={{ alignItems: "center" }}>
        <span className="hint" style={{ margin: 0, color: "var(--amber)", fontWeight: 600 }}>
          ⚠ {problems.length} of your top-{topN} players {problems.length === 1 ? "is" : "are"} on the bench in{" "}
          {problemLeagues} league{problemLeagues === 1 ? "" : "s"} while a lower-ranked player starts
        </span>
        <span style={{ flex: 1 }} />
        {topInput}
        <button className="btn ghost sm" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Show"}</button>
        <button className="btn sm" onClick={onFix}>Fix in Optimize</button>
      </div>
      {unavailable.length > 0 && (
        <p className="portmeta" style={{ margin: "6px 0 0" }}>
          {unavailable.length} more top player{unavailable.length === 1 ? " is" : "s are"} benched because
          they&rsquo;re injured or on bye — not counted.
        </p>
      )}
      {open && (
        <div style={{ marginTop: 10, maxHeight: 360, overflowY: "auto" }}>
          {problems.map((r) => (
            <div key={r.key} className="mgrrow static" style={{ minHeight: 40 }}>
              <PlayerAvatar playerId={r.playerId} pos={pmap[r.playerId]?.p} size={24} />
              <span className="tname" style={{ flex: 1 }}>
                {name(r.playerId)} <span className="portmeta">{r.priority ? "★ priority" : rankText(r.playerId)}</span>
                <span className="portmeta" style={{ display: "block", fontWeight: 400 }}>{r.leagueName}</span>
              </span>
              {pmap[r.playerId]?.p && <span className="pos" style={posChipStyle(pmap[r.playerId].p)}>{pmap[r.playerId].p}</span>}
              <span className="portmeta" style={{ minWidth: 220 }}>
                {r.displaces
                  ? `${name(r.displaces)} (${rankText(r.displaces)}) is starting in his spot`
                  : "an eligible slot is empty"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
