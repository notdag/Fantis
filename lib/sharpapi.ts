// Client for our own /api/mvp-odds proxy — never talks to SharpAPI directly,
// so the API key stays server-side. See app/api/mvp-odds/route.ts.
import { today } from "./sleeper";

export interface MvpOddsEntry {
  american: number;
  probability: number;
  sportsbook: string;
}

const CACHE_KEY = "fantis_mvp_odds_v1";

// Same reasoning as getPlayerProps() in lib/sportsgameodds.ts — the server
// route caches SharpAPI for an hour, but nothing cached it on the client,
// so every mount of the Rankings detail panel re-hit the route. MVP odds
// move slowly, so a day-long client cache (the same convention used
// throughout lib/sleeper.ts) is a reasonable trade for cutting real API
// calls, not just a redundant safety net.
//
// inFlight dedupes simultaneous callers (e.g. Strict Mode's double-invoked
// effects) so they share one real request instead of each missing the
// not-yet-written cache and firing their own — see getPlayerProps().
let inFlight: Promise<Record<string, MvpOddsEntry>> | null = null;

export async function getMvpOdds(): Promise<Record<string, MvpOddsEntry>> {
  if (typeof window !== "undefined") {
    try {
      const cached = window.localStorage.getItem(CACHE_KEY);
      if (cached) {
        const d = JSON.parse(cached) as { day: string; odds: Record<string, MvpOddsEntry> };
        if (d.day === today()) return d.odds;
      }
    } catch {
      // ignore cache read errors
    }
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch("/api/mvp-odds");
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as { odds: Record<string, MvpOddsEntry> };
      const odds = json.odds ?? {};

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(CACHE_KEY, JSON.stringify({ day: today(), odds }));
        } catch {
          // ignore cache write errors (e.g. quota exceeded)
        }
      }

      return odds;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
