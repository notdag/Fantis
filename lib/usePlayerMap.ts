"use client";

import { useCallback, useEffect, useState } from "react";
import { getPlayers, playersUpdatedAt, refreshPlayers } from "./sleeper";
import type { PlayerMap } from "./types";

type Status = "loading" | "error" | "success";

export function usePlayerMap() {
  const [pmap, setPmap] = useState<PlayerMap | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPlayers()
      .then((m) => {
        if (!cancelled) {
          setPmap(m);
          setUpdatedAt(playersUpdatedAt());
          setStatus("success");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setStatus("loading");
    setAttempt((a) => a + 1);
  };

  // Pull a fresh copy now (injury designations, teams). Resolves to a short human message for the UI.
  const refresh = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    setRefreshing(true);
    try {
      const res = await refreshPlayers();
      setPmap(res.map);
      setUpdatedAt(res.at);
      return {
        ok: true,
        message: res.refreshed ? "Injuries and player data refreshed from Sleeper." : "Already refreshed in the last 2 minutes — up to date.",
      };
    } catch {
      return { ok: false, message: "Couldn't reach Sleeper to refresh injuries — still showing the previous data." };
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { pmap, loading: status === "loading", error: status === "error", retry, refresh, refreshing, updatedAt };
}
