"use client";

import { useEffect, useState } from "react";
import { getPlayers } from "./sleeper";

export const stripSuffix = (name: string) =>
  name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim();

export interface SleeperIdMaps {
  byName: Record<string, string>;
  byBase: Record<string, string>;
}

// Position-scoped lookup: several curated names collide with an unrelated
// player elsewhere in Sleeper's ~11k-player dump (e.g. two "Lamar
// Jackson"s — the Ravens QB and an inactive CB), so position has to be
// part of the key or the wrong, data-empty player gets matched.
export const sleeperId = (maps: SleeperIdMaps, p: { name: string; pos: string }) =>
  maps.byName[`${p.name}|${p.pos}`] || maps.byBase[`${stripSuffix(p.name)}|${p.pos}`];

// Resolves Sleeper player IDs for our curated list once, independent of
// week — shared by anything that needs to cross-reference our players
// against live Sleeper data (Rankings, trade values, ...).
export function useSleeperIdMaps(): SleeperIdMaps | null {
  const [idMaps, setIdMaps] = useState<SleeperIdMaps | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pmap = await getPlayers();
      if (cancelled) return;
      // Sleeper sometimes omits the suffix we carry in our curated list
      // (e.g. "Brian Thomas" vs. "Brian Thomas Jr."), so match exact name
      // first and fall back to a suffix-stripped comparison.
      const byName: Record<string, string> = {};
      const byBase: Record<string, string> = {};
      for (const id in pmap) {
        const entry = pmap[id];
        byName[`${entry.n}|${entry.p}`] = id;
        const baseKey = `${stripSuffix(entry.n)}|${entry.p}`;
        if (!(baseKey in byBase)) byBase[baseKey] = id;
      }
      setIdMaps({ byName, byBase });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return idMaps;
}
