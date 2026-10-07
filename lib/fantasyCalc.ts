"use client";

import { useEffect, useState } from "react";
import { stripSuffix } from "./playerIdMap";
import type { FantasyCalcValue } from "@/app/api/fantasycalc-values/route";

export interface FantasyCalcMaps {
  byName: Record<string, number>; // "name|pos" -> value
  byBase: Record<string, number>; // "stripped name|pos" -> value, fallback for suffix mismatches
}

// Fetches FantasyCalc's real player values (via the server proxy at
// app/api/fantasycalc-values) once and keys them the same way
// lib/playerIdMap.ts keys Sleeper IDs, so callers can match on
// name+position with the same suffix-fallback behavior used everywhere
// else in the app.
export function useFantasyCalcValues(): FantasyCalcMaps | null {
  const [maps, setMaps] = useState<FantasyCalcMaps | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fantasycalc-values")
      .then((r) => r.json())
      .then((json: { values?: FantasyCalcValue[] }) => {
        if (cancelled || !json.values) return;
        const byName: Record<string, number> = {};
        const byBase: Record<string, number> = {};
        for (const v of json.values) {
          byName[`${v.name}|${v.pos}`] = v.value;
          const baseKey = `${stripSuffix(v.name)}|${v.pos}`;
          if (!(baseKey in byBase)) byBase[baseKey] = v.value;
        }
        setMaps({ byName, byBase });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return maps;
}

export function fantasyCalcValue(
  maps: FantasyCalcMaps,
  p: { name: string; pos: string }
): number {
  return maps.byName[`${p.name}|${p.pos}`] ?? maps.byBase[`${stripSuffix(p.name)}|${p.pos}`] ?? 0;
}
