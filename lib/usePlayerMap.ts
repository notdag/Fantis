"use client";

import { useEffect, useState } from "react";
import { getPlayers } from "./sleeper";
import type { PlayerMap } from "./types";

type Status = "loading" | "error" | "success";

export function usePlayerMap() {
  const [pmap, setPmap] = useState<PlayerMap | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getPlayers()
      .then((m) => {
        if (!cancelled) {
          setPmap(m);
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

  return { pmap, loading: status === "loading", error: status === "error", retry };
}
