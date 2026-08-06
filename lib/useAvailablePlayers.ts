"use client";

import { useMemo } from "react";
import { isRankedAdp } from "./sleeper";
import { useProjections } from "./useProjections";
import type { LeagueBundle } from "./types";

export interface AvailablePlayer {
  id: string;
  name: string;
  pos: string;
  team: string;
  adp: number | null;
  proj: number | null;
  wireRank: number;
}

// Players in a league's Sleeper player pool that aren't on any roster —
// shared by Waiver Wire and the league view's Waivers column.
export function useAvailablePlayers(sel: LeagueBundle | null) {
  const { projections, week, loading, error } = useProjections();

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

  return { available, week, loading, error };
}
