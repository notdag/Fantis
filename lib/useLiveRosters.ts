"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchAllLive, type LiveRoster, type LiveTarget } from "./liveRosters";

export interface LiveRosterState {
  live: Record<string, LiveRoster>;
  failed: { leagueId: string; message: string }[];
  loading: boolean;
  done: number;
  total: number;
  loadedAt: number | null;
  reload: () => void;
}

const STALE_AFTER_MS = 3 * 60_000;

// Reads the owner's current roster in every league straight from Sleeper: once when the page opens, on demand
// (reload), and automatically when the tab becomes visible again after a few minutes — so leaving the page open
// through a game day never leaves it showing old rosters.
export function useLiveRosters(targets: LiveTarget[]): LiveRosterState {
  const key = useMemo(() => targets.map((t) => `${t.leagueId}:${t.rosterId}`).join(","), [targets]);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<LiveRosterState, "reload">>({
    live: {},
    failed: [],
    loading: true,
    done: 0,
    total: targets.length,
    loadedAt: null,
  });

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, done: 0 }));
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAllLive(targets, {
      onProgress: (done, total) => {
        if (!cancelled) setState((s) => ({ ...s, done, total }));
      },
    })
      .then((res) => {
        if (cancelled) return;
        setState({ live: res.live, failed: res.failed, loading: false, done: targets.length, total: targets.length, loadedAt: Date.now() });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
    // `targets` is captured via `key`; reload() bumps `tick`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && state.loadedAt && Date.now() - state.loadedAt > STALE_AFTER_MS && !state.loading) reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state.loadedAt, state.loading, reload]);

  return { ...state, reload };
}
