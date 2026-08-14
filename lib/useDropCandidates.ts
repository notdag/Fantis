"use client";

import { useEffect, useState } from "react";
import { getSeasonProjectionTotals, getState } from "./sleeper";
import type { SeasonProjectionTotal } from "./types";

// Real season-long PPR projection per player, same source and same
// day-cached fetch pattern as lib/useTradeValues.ts's season-totals effect
// (getState() -> getSeasonProjectionTotals(season)) — reused verbatim
// rather than re-fetched, since it's the same underlying data. Unlike
// useTradeValues, this doesn't need lib/playerIdMap.ts's name-matching:
// Roster.players/starters are already stored as real Sleeper player ids.
export function useSeasonTotals(): Record<string, SeasonProjectionTotal> | null {
  const [seasonTotals, setSeasonTotals] = useState<Record<string, SeasonProjectionTotal> | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await getState();
        const totals = await getSeasonProjectionTotals(state.season);
        if (!cancelled) setSeasonTotals(totals);
      } catch {
        // Drop suggestions just won't be available yet — callers show "—".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return seasonTotals;
}

export interface DropCandidate {
  playerId: string;
  value: number;
  fromBench: boolean;
}

// Lowest real season-points bench player (players minus starters). Falls
// back to the lowest-value starter only when there's no bench at all —
// flagged via fromBench so the UI can say so explicitly rather than
// suggesting a starter drop silently. Returns null when there's nothing to
// rank (empty roster) or no season data yet.
export function pickDropCandidate(
  players: string[],
  starters: string[],
  seasonTotals: Record<string, SeasonProjectionTotal> | null
): DropCandidate | null {
  if (!seasonTotals || players.length === 0) return null;

  const rank = (ids: string[]): DropCandidate | null => {
    let best: DropCandidate | null = null;
    for (const id of ids) {
      const pts = seasonTotals[id]?.pts;
      if (pts == null) continue;
      if (!best || pts < best.value) best = { playerId: id, value: pts, fromBench: true };
    }
    return best;
  };

  const bench = players.filter((id) => !starters.includes(id));
  const benchPick = rank(bench);
  if (benchPick) return benchPick;

  const starterPick = rank(players);
  return starterPick ? { ...starterPick, fromBench: false } : null;
}
