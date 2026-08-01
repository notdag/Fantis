// Sleeper public API client — read-only, no auth, works client-side.
import type {
  PlayerMap,
  ProjectionMap,
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
