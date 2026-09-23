"use client";

import { useMemo } from "react";
import { usePlayers } from "@/lib/usePlayers";
import { useSleeperIdMaps, sleeperId } from "@/lib/playerIdMap";

export interface CuratedRank {
  order: number; // 0 = best in the owner's overall /admin ordering
  tier: number;
  posRank: number;
}

// The owner's curated /admin rankings keyed by Sleeper player id, so lineup
// tools can compare them to roster players. Null until both the curated list
// and the id lookup have loaded. Uses the same name+position matching
// (lib/playerIdMap.ts) as Rankings and trade values; a curated player that
// can't be matched to a Sleeper id is simply absent (treated as unranked).
export function useCuratedRanks(): Map<string, CuratedRank> | null {
  const players = usePlayers();
  const idMaps = useSleeperIdMaps();
  return useMemo(() => {
    if (!idMaps || players.length === 0) return null;
    const out = new Map<string, CuratedRank>();
    players.forEach((p, i) => {
      const id = sleeperId(idMaps, { name: p.name, pos: p.pos });
      if (id && !out.has(id)) out.set(id, { order: i, tier: p.tier, posRank: p.posRank });
    });
    return out;
  }, [players, idMaps]);
}
