// Sleeper public API client — read-only, no auth, works client-side.
import type {
  PlayerMap,
  ProjectionMap,
  SeasonProjectionTotal,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperPlayerRaw,
  SleeperRoster,
  SleeperState,
  SleeperUser,
} from "./types";

const S = "https://api.sleeper.app/v1";

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
}

export const getUser = (username: string) =>
  jget<SleeperUser>(`${S}/user/${encodeURIComponent(username)}`);

export const getLeagues = (userId: string, season: string) =>
  jget<SleeperLeague[]>(`${S}/user/${userId}/leagues/nfl/${season}`);

export const getRosters = (leagueId: string) =>
  jget<SleeperRoster[]>(`${S}/league/${leagueId}/rosters`);

export const getLeagueUsers = (leagueId: string) =>
  jget<SleeperLeagueUser[]>(`${S}/league/${leagueId}/users`);

const today = () => new Date().toISOString().slice(0, 10);

const PLAYERS_CACHE_KEY = "fantis_players_nfl_v1";

// Sleeper's full player dump is several MB; cache it in localStorage for the day.
export async function getPlayers(): Promise<PlayerMap> {
  if (typeof window !== "undefined") {
    try {
      const cached = window.localStorage.getItem(PLAYERS_CACHE_KEY);
      if (cached) {
        const d = JSON.parse(cached) as { day: string; map: PlayerMap };
        if (d.day === today()) return d.map;
      }
    } catch {
      // ignore cache read errors
    }
  }

  const raw = await jget<Record<string, SleeperPlayerRaw | null>>(
    `${S}/players/nfl`
  );
  const map: PlayerMap = {};
  for (const id in raw) {
    const p = raw[id];
    if (!p) continue;
    map[id] = {
      n: p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || id,
      p: p.position || "",
      t: p.team || "",
      age: p.age,
      exp: p.years_exp,
      college: p.college,
      inj: p.injury_status,
    };
  }

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        PLAYERS_CACHE_KEY,
        JSON.stringify({ day: today(), map })
      );
    } catch {
      // ignore cache write errors (e.g. quota exceeded)
    }
  }

  return map;
}

export const avatar = (id: string | null | undefined) =>
  id ? `https://sleepercdn.com/avatars/thumbs/${id}` : null;

export const SEASONS = ["2026", "2025", "2024"];

export const getState = () => jget<SleeperState>(`${S}/state/nfl`);

// Sleeper only exposes per-week ADP/projections, not a season total — pick
// the most relevant upcoming week: week 1 during preseason, otherwise the
// current week.
export function currentProjectionWeek(state: SleeperState): number {
  return state.season_type === "regular" ? Math.max(1, state.week) : 1;
}

const PROJECTIONS_CACHE_PREFIX = "fantis_projections_v1_";

// ~500KB across all NFL players for one week; cache per season+week for the day.
export async function getProjections(
  season: string,
  week: number
): Promise<ProjectionMap> {
  const cacheKey = `${PROJECTIONS_CACHE_PREFIX}${season}_${week}`;
  if (typeof window !== "undefined") {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const d = JSON.parse(cached) as { day: string; map: ProjectionMap };
        if (d.day === today()) return d.map;
      }
    } catch {
      // ignore cache read errors
    }
  }

  const raw = await jget<Record<string, ProjectionMap[string] | null>>(
    `${S}/projections/nfl/regular/${season}/${week}`
  );
  const map: ProjectionMap = {};
  for (const id in raw) {
    const p = raw[id];
    if (!p) continue;
    map[id] = { adp_dd_ppr: p.adp_dd_ppr, pts_ppr: p.pts_ppr };
  }

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify({ day: today(), map }));
    } catch {
      // ignore cache write errors (e.g. quota exceeded)
    }
  }

  return map;
}

// Sleeper treats ~999+ as "outside the ranked player pool" for ADP.
export const isRankedAdp = (adp: number | undefined): adp is number =>
  typeof adp === "number" && adp < 999;

interface RawWeeklyProjection {
  pts_ppr?: number;
  rush_yd?: number;
  rec_yd?: number;
  pass_yd?: number;
  rush_td?: number;
  rec_td?: number;
  pass_td?: number;
}

// NFL regular season: 18 weeks, each team gets exactly one bye within them.
const SEASON_WEEKS = 18;
const SEASON_TOTALS_CACHE_PREFIX = "fantis_season_totals_v1_";

// Sleeper has no season-total endpoint, so this fetches all 18 weekly
// projection files (~10MB total) and sums them per player. Deliberately NOT
// layered on top of getProjections()'s per-week cache — caching every week's
// full payload individually would be ~15-20MB in localStorage, on top of the
// player dump. Instead only the final summed result (~1MB) is cached.
// This is a heavy, explicit operation — callers should treat it as opt-in,
// not something to fire automatically on page load.
export async function getSeasonProjectionTotals(
  season: string,
  onProgress?: (weeksDone: number, totalWeeks: number) => void
): Promise<Record<string, SeasonProjectionTotal>> {
  const cacheKey = `${SEASON_TOTALS_CACHE_PREFIX}${season}`;
  if (typeof window !== "undefined") {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const d = JSON.parse(cached) as {
          day: string;
          totals: Record<string, SeasonProjectionTotal>;
        };
        if (d.day === today()) return d.totals;
      }
    } catch {
      // ignore cache read errors
    }
  }

  const totals: Record<string, SeasonProjectionTotal> = {};
  for (let week = 1; week <= SEASON_WEEKS; week++) {
    const raw = await jget<Record<string, RawWeeklyProjection | null>>(
      `${S}/projections/nfl/regular/${season}/${week}`
    );
    for (const id in raw) {
      const p = raw[id];
      if (!p || p.pts_ppr == null) continue;
      const t = totals[id] || {
        pts: 0,
        rushYd: 0,
        recYd: 0,
        passYd: 0,
        rushTd: 0,
        recTd: 0,
        passTd: 0,
        weeksCounted: 0,
      };
      t.pts += p.pts_ppr;
      t.rushYd += p.rush_yd ?? 0;
      t.recYd += p.rec_yd ?? 0;
      t.passYd += p.pass_yd ?? 0;
      t.rushTd += p.rush_td ?? 0;
      t.recTd += p.rec_td ?? 0;
      t.passTd += p.pass_td ?? 0;
      t.weeksCounted += 1;
      totals[id] = t;
    }
    onProgress?.(week, SEASON_WEEKS);
  }

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify({ day: today(), totals }));
    } catch {
      // ignore cache write errors (e.g. quota exceeded) — will refetch next time
    }
  }

  return totals;
}

const WEEKLY_STATS_CACHE_PREFIX = "fantis_weekly_stats_v1_";

// Real per-week PPR points from a completed season — Sleeper's /stats
// endpoint (actual box scores), not /projections. Only pass a season that's
// already finished; a season in progress will just have nulls for future
// weeks. Same heavy-fetch-but-cache-only-the-summary shape as
// getSeasonProjectionTotals — opt-in, not fired automatically.
export async function getSeasonWeeklyStats(
  season: string
): Promise<Record<string, (number | null)[]>> {
  const cacheKey = `${WEEKLY_STATS_CACHE_PREFIX}${season}`;
  if (typeof window !== "undefined") {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const d = JSON.parse(cached) as {
          day: string;
          weekly: Record<string, (number | null)[]>;
        };
        if (d.day === today()) return d.weekly;
      }
    } catch {
      // ignore cache read errors
    }
  }

  const weekly: Record<string, (number | null)[]> = {};
  for (let week = 1; week <= SEASON_WEEKS; week++) {
    const raw = await jget<Record<string, { pts_ppr?: number } | null>>(
      `${S}/stats/nfl/regular/${season}/${week}`
    );
    for (const id in raw) {
      const p = raw[id];
      if (!weekly[id]) weekly[id] = new Array(SEASON_WEEKS).fill(null);
      weekly[id][week - 1] = p?.pts_ppr ?? null;
    }
  }

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify({ day: today(), weekly }));
    } catch {
      // ignore cache write errors (e.g. quota exceeded) — will refetch next time
    }
  }

  return weekly;
}
