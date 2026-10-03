"use client";

import { useEffect, useState } from "react";
import type { RefRank } from "./refRanks";

// Expert / Mason Dodd reference ranks for the public Rankings page (read-only endpoint).
// Resolves to an empty map on any failure — the columns then just show "n/a", never an error.
let cache: Record<string, RefRank> | null = null;

export function usePublicRefRanks(): Record<string, RefRank> {
  const [ranks, setRanks] = useState<Record<string, RefRank>>(cache ?? {});
  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    fetch("/api/reference-ranks")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { ranks?: Record<string, RefRank> } | null) => {
        if (cancelled || !body?.ranks) return;
        cache = body.ranks;
        setRanks(body.ranks);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return ranks;
}
