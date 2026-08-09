"use client";

import { useEffect, useState } from "react";
import { getWeekGameContext, type TeamGameContext } from "./espnGames";

// This week's real per-team spread/total/win-probability, keyed by team
// abbreviation — shared by any component that wants game-environment
// context (Rankings detail panel today).
export function useGameContext(season: string | null, week: number | null) {
  const [data, setData] = useState<Record<string, TeamGameContext>>({});

  useEffect(() => {
    if (!season || !week) return;
    let cancelled = false;
    getWeekGameContext(season, week)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        // game context is a bonus panel stat, not core to the page — fail quietly
      });
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  return data;
}
