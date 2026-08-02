"use client";

import { useMemo, useState } from "react";
import { posChipStyle } from "@/lib/players";
import { isRankedAdp } from "@/lib/sleeper";
import { useProjections } from "@/lib/useProjections";
import SortHeader from "@/components/SortHeader";
import type { LeagueBundle } from "@/lib/types";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;
const MAX_ROWS = 150;

interface AvailablePlayer {
  id: string;
  name: string;
  pos: string;
  team: string;
  adp: number | null;
  proj: number | null;
  wireRank: number;
}

type SortKey = "adp" | "proj";
type SortDir = "asc" | "desc";
const DEFAULT_DIR: Record<SortKey, SortDir> = { adp: "asc", proj: "desc" };

export default function WaiverWire({
  sel,
  onGoToLeagues,
}: {
  sel: LeagueBundle | null;
  onGoToLeagues: () => void;
}) {
  const { projections, week, loading, error } = useProjections();
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [sortBy, setSortBy] = useState<SortKey>("proj");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const available = useMemo<AvailablePlayer[]>(() => {
    if (!sel || !projections) return [];

    const rostered = new Set<string>();
    for (const t of sel.teams) for (const id of t.players) rostered.add(id);

    const pool: AvailablePlayer[] = [];
    for (const id in sel.pmap) {
      if (rostered.has(id)) continue;
      const p = sel.pmap[id];
      if (!p.t) continue; // not on an active NFL roster — not a real waiver target
      if (!["QB", "RB", "WR", "TE"].includes(p.p)) continue;
      const proj = projections[id];
      if (proj?.pts_ppr == null) continue; // no live signal — not worth listing
      pool.push({
        id,
        name: p.n,
        pos: p.p,
        team: p.t,
        adp: isRankedAdp(proj.adp_dd_ppr) ? Math.round(proj.adp_dd_ppr) : null,
        proj: proj.pts_ppr,
        wireRank: 0,
      });
    }

    const byPos: Record<string, AvailablePlayer[]> = {};
    for (const p of pool) (byPos[p.pos] ||= []).push(p);
    for (const group of Object.values(byPos)) {
      group.sort((a, b) => (b.proj ?? -1) - (a.proj ?? -1)).forEach((p, i) => (p.wireRank = i + 1));
    }

    return pool;
  }, [sel, projections]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  };

  const list = useMemo(() => {
    const filtered = available.filter((p) => pos === "ALL" || p.pos === pos);
    const dir = sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
    return filtered.slice(0, MAX_ROWS);
  }, [available, pos, sortBy, sortDir]);

  if (!sel) {
    return (
      <section className="sec">
        <div className="sechead">
          <h2>Waiver Wire</h2>
        </div>
        <p className="hint">
          This ranks unrostered players in your specific league — open a league first.
        </p>
        <button className="btn ghost sm" onClick={onGoToLeagues} style={{ marginTop: 10 }}>
          Go to Leagues →
        </button>
      </section>
    );
  }

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Waiver Wire</h2>
        <span className="rt">
          {sel.lg.name}
          {week != null && ` · Week ${week} proj. via Sleeper`}
        </span>
      </div>
      <div className="filters">
        {POSITIONS.map((p) => (
          <button
            key={p}
            className={`chip-filter ${pos === p ? "on" : ""}`}
            onClick={() => setPos(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {loading && <p className="hint">Loading live projections…</p>}
      {error && <p className="hint">{error}</p>}
      {!loading && !error && available.length === 0 && (
        <p className="hint">No unrostered players with live projections yet.</p>
      )}
      {!loading && available.length > MAX_ROWS && (
        <p className="hint">Showing the top {MAX_ROWS} by current sort.</p>
      )}
      {list.length > 0 && (
        <div className="board">
          <div className="row ww head">
            <div className="cell">#</div>
            <div className="cell">Player</div>
            <div className="cell r">Pos</div>
            <div className="cell r">
              <SortHeader label="ADP" sortKey="adp" active={sortBy} dir={sortDir} onClick={toggleSort} />
            </div>
            <div className="cell r">
              <SortHeader label="Proj" sortKey="proj" active={sortBy} dir={sortDir} onClick={toggleSort} />
            </div>
          </div>
          {list.map((p, i) => (
            <div className="row ww" key={p.id}>
              <div className={`cell rank ${i < 3 ? "top" : ""}`}>{i + 1}</div>
              <div className="cell team">
                <span className="tname">{p.name}</span>
                <span style={{ color: "var(--dim)", fontSize: 12, marginLeft: 8 }}>{p.team}</span>
              </div>
              <div className="cell r">
                <span className="pos" style={posChipStyle(p.pos)}>
                  {p.pos}
                  {p.wireRank}
                </span>
              </div>
              <div className="cell r num" style={{ color: "var(--muted)" }}>
                {p.adp != null ? p.adp : "—"}
              </div>
              <div className="cell r num val">{p.proj != null ? p.proj.toFixed(1) : "—"}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
