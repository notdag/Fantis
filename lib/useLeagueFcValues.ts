"use client";

import { useCallback, useEffect, useState } from "react";

// FantasyCalc values per LEAGUE (each league's own format), read from our
// database via /api/fantasycalc/league-values — keyed by Sleeper player id, so
// matching is exact (no name guessing). Owner-only (/manager). Numbers are
// FantasyCalc's; show attribution wherever they appear.
interface Payload {
  formats: Record<string, string>; // leagueId → formatKey
  describe: Record<string, string>; // formatKey → "redraft, 1QB, 12-team, PPR"
  values: Record<string, Record<string, [number, number, number, number]>>; // formatKey → sleeperId → [value, overallRank, positionRank, trend30Day]
  fetchedAt: Record<string, number | null>;
  refreshing: boolean;
}

export interface LeagueFc {
  ready: boolean;
  refreshing: boolean;
  value: (leagueId: string, sleeperId: string) => number | null;
  rank: (leagueId: string, sleeperId: string) => { overall: number; position: number; trend30Day: number } | null;
  format: (leagueId: string) => string | null; // human description of the FantasyCalc format used
  asOf: (leagueId: string) => number | null;
}

let cache: Payload | null = null;

export function useLeagueFcValues(): LeagueFc {
  const [data, setData] = useState<Payload | null>(cache);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async (retry: boolean) => {
      try {
        const res = await fetch("/api/fantasycalc/league-values");
        if (!res.ok) return;
        const p = (await res.json()) as Payload;
        if (cancelled) return;
        cache = p;
        setData(p);
        // First ever load: the server is filling the database in the background — look again shortly.
        if (retry && p.refreshing && Object.keys(p.values).length === 0) timer = window.setTimeout(() => void load(false), 25_000);
      } catch {
        // FantasyCalc values are a bonus signal — everything works without them
      }
    };
    void load(true);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const value = useCallback((leagueId: string, sleeperId: string) => {
    if (!data) return null;
    const k = data.formats[leagueId];
    return (k && data.values[k]?.[sleeperId]?.[0]) || null;
  }, [data]);
  const rank = useCallback((leagueId: string, sleeperId: string) => {
    if (!data) return null;
    const k = data.formats[leagueId];
    const v = k ? data.values[k]?.[sleeperId] : undefined;
    return v ? { overall: v[1], position: v[2], trend30Day: v[3] } : null;
  }, [data]);
  const format = useCallback((leagueId: string) => (data && data.describe[data.formats[leagueId]]) || null, [data]);
  const asOf = useCallback((leagueId: string) => (data ? data.fetchedAt[data.formats[leagueId]] ?? null : null), [data]);

  return { ready: !!data && Object.keys(data.values).length > 0, refreshing: !!data?.refreshing, value, rank, format, asOf };
}
