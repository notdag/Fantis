// Client for our own /api/player-props proxy — never talks to
// SportsGameOdds directly, so the API key stays server-side. See
// app/api/player-props/route.ts.
import { today } from "./sleeper";

export interface PropLine {
  stat: string;
  line: number | null;
  overOdds: string | null;
  underOdds: string | null;
}

const CACHE_KEY = "fantis_player_props_v1";

// The server route already caches SportsGameOdds for 12h, but every
// component that calls this (Trade, League view — anywhere
// useTradeValues() mounts) had no cache of its own, so just opening the
// site re-hit /api/player-props on every mount. That's fine most of the
// time (server cache absorbs it), but a dev-server restart clears that
// cache, and a fresh hit then costs real SportsGameOdds quota. Caching the
// result in localStorage for the day means at most one real round-trip
// per browser per day, matching the day-cache convention used everywhere
// else in lib/sleeper.ts.
//
// The localStorage check alone doesn't stop simultaneous callers on the
// same page load (e.g. React Strict Mode's double-invoked effects) — they
// all miss the cache before any of them has written to it. inFlight makes
// concurrent calls share one real request instead of each firing their own.
let inFlight: Promise<Record<string, PropLine[]>> | null = null;

export async function getPlayerProps(): Promise<Record<string, PropLine[]>> {
  if (typeof window !== "undefined") {
    try {
      const cached = window.localStorage.getItem(CACHE_KEY);
      if (cached) {
        const d = JSON.parse(cached) as { day: string; props: Record<string, PropLine[]> };
        if (d.day === today()) return d.props;
      }
    } catch {
      // ignore cache read errors
    }
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch("/api/player-props");
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as { props: Record<string, PropLine[]> };
      const props = json.props ?? {};

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(CACHE_KEY, JSON.stringify({ day: today(), props }));
        } catch {
          // ignore cache write errors (e.g. quota exceeded)
        }
      }

      return props;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
