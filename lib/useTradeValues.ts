"use client";

import { useEffect, useMemo, useState } from "react";
import { usePlayers } from "./usePlayers";
import { getSeasonProjectionTotals, getState } from "./sleeper";
import { getPlayerProps, type PropLine } from "./sportsgameodds";
import { sleeperId, stripSuffix, useSleeperIdMaps } from "./playerIdMap";
import { computeTradeValue, type TradeValueResult } from "./tradeValue";
import type { SeasonProjectionTotal } from "./types";

// Computes each curated player's trade value (see lib/tradeValue.ts for the
// methodology) once per page load. Both underlying fetches are already
// cached elsewhere in the app (season totals in localStorage for the day,
// props for 12h server-side), so this doesn't add new network cost beyond
// what Rankings already pays if it's open in another tab.
export function useTradeValues(): Record<string, TradeValueResult> {
  const PLAYERS = usePlayers();
  const idMaps = useSleeperIdMaps();
  const [seasonTotals, setSeasonTotals] = useState<Record<string, SeasonProjectionTotal> | null>(
    null
  );
  const [props, setProps] = useState<Record<string, PropLine[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await getState();
        const totals = await getSeasonProjectionTotals(state.season);
        if (!cancelled) setSeasonTotals(totals);
      } catch {
        // trade values just won't be available — Trade.tsx handles this gracefully
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPlayerProps()
      .then((p) => {
        if (!cancelled) setProps(p);
      })
      .catch(() => {
        // props are a bonus signal, not required — fail quietly, same as elsewhere
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const out: Record<string, TradeValueResult> = {};
    if (!idMaps || !seasonTotals) return out;
    for (const p of PLAYERS) {
      const id = sleeperId(idMaps, p);
      const season = id ? seasonTotals[id] : undefined;
      const playerProps = props[p.name] || props[stripSuffix(p.name)];
      const result = computeTradeValue(season, playerProps);
      if (result) out[p.name] = result;
    }
    return out;
  }, [PLAYERS, idMaps, seasonTotals, props]);
}
