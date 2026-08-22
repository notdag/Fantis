"use client";

import { useEffect, useState } from "react";
import type { Player } from "./types";

// The curated player list — real, DB-backed (RankedPlayer in
// prisma/schema.prisma) via /api/players — replacing the old statically-
// imported PLAYERS array so an /admin tier-board save applies on the very
// next load instead of needing a paste-and-commit-and-deploy round trip.
// Module-level in-memory cache only (never localStorage): a fresh tab
// should always see the current DB state, and every component on one page
// that calls this shares a single fetch instead of each re-requesting it.
let cache: Player[] | null = null;
let inflight: Promise<Player[]> | null = null;

function fetchPlayers(): Promise<Player[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/players")
      .then((r) => r.json())
      .then((data: Player[]) => {
        cache = data;
        inflight = null;
        return data;
      })
      .catch((e) => {
        inflight = null;
        throw e;
      });
  }
  return inflight;
}

export function usePlayers(): Player[] {
  const [players, setPlayers] = useState<Player[]>(cache ?? []);
  useEffect(() => {
    let cancelled = false;
    fetchPlayers()
      .then((data) => {
        if (!cancelled) setPlayers(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return players;
}
