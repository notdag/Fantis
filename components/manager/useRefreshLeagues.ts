"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

// Right after a change made through Fantis (lineup, IR, add/drop, trade), re-sync
// JUST those leagues from Sleeper and refresh the page's server data, so the
// Action Queue, Lineups banner and rosters stop showing the old state. Returns
// whether the refresh worked, so callers can say so instead of guessing. This
// is a partial sync: it doesn't change the header's "synced X ago" (that stays
// the last FULL sync), and it uses the admin cookie only — no Sleeper token.
export function useRefreshLeagues() {
  const router = useRouter();
  return useCallback(
    async (leagueIds: string[]): Promise<boolean> => {
      const ids = [...new Set(leagueIds)].filter((id) => /^[0-9]+$/.test(id));
      if (ids.length === 0) return false;
      try {
        const res = await fetch("/api/manager/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leagueIds: ids }),
        });
        if (!res.ok) return false;
        router.refresh();
        return true;
      } catch {
        return false;
      }
    },
    [router]
  );
}
