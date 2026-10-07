"use client";

import { useCallback } from "react";
import { useTradeValues } from "@/lib/useTradeValues";
import { useFantasyCalcValues, fantasyCalcValue } from "@/lib/fantasyCalc";
import type { DropRank } from "@/lib/bulkPlan";
import type { PlayerMap } from "@/lib/types";

// "How much do I want to keep this player" for drop suggestions: Fantis's
// own curated trade value first, FantasyCalc's value as a separate
// tie-breaker (uncurated players are all 0 on the first). Two numbers, never
// summed — same "second opinion, never blended" rule as the rest of the app.
export function useDropRank(pmap: PlayerMap | null): DropRank {
  const tradeValues = useTradeValues();
  const fcValues = useFantasyCalcValues();
  return useCallback(
    (playerId: string): [number, number] => {
      const entry = pmap?.[playerId];
      if (!entry) return [0, 0];
      const fantis = tradeValues[entry.n]?.value ?? 0;
      const fc = fcValues ? fantasyCalcValue(fcValues, { name: entry.n, pos: entry.p }) : 0;
      return [fantis, fc];
    },
    [pmap, tradeValues, fcValues]
  );
}
