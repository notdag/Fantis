"use client";

import { useEffect, useState } from "react";
import { currentProjectionWeek, getProjections, getState } from "./sleeper";
import type { ProjectionMap } from "./types";

// Resolves the current NFL state to the most relevant projection week, then
// fetches+caches that week's projections. Shared by every feature that needs
// live ADP/projected points (Rankings, Start/Sit, Waiver Wire).
export function useProjections() {
  const [projections, setProjections] = useState<ProjectionMap | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await getState();
        const wk = currentProjectionWeek(state);
        const proj = await getProjections(state.season, wk);
        if (cancelled) return;
        setProjections(proj);
        setWeek(wk);
      } catch {
        if (!cancelled) setError("Couldn't load live projections from Sleeper.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { projections, week, loading, error };
}
