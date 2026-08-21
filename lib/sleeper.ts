// Sleeper public API client — read-only, no auth, works client-side.
import type {
  PlayerMap,
  ProjectionMap,
  SeasonProjectionTotal,
  SleeperLeague,
  SleeperLeagueDetail,
  SleeperLeagueUser,
  SleeperPlayerRaw,
  SleeperRoster,
  SleeperState,
  SleeperTransaction,
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

// Real starting-lineup shape (roster_positions) and real reception scoring
// (scoring_settings.rec) for one league — used by Start/Sit so it reflects
// this league's actual rules instead of a generic full-PPR default.
export const getLeagueDetail = (leagueId: string) =>
  jget<SleeperLeagueDetail>(`${S}/league/${leagueId}`);

export const getLeagueUsers = (leagueId: string) =>
  jget<SleeperLeagueUser[]>(`${S}/league/${leagueId}/users`);

// Full, unshaped GET /league/{id} response — same real endpoint as
// getLeagueDetail above, but kept loosely typed and used by Sleeper
// Manager's sync (lib/managerSync.ts), which stores the whole payload
// verbatim rather than picking out specific fields ahead of time. Doesn't
// touch getLeagueDetail's existing typed call site in Start/Sit.
export const getLeagueRaw = (leagueId: string) =>
  jget<Record<string, unknown>>(`${S}/league/${leagueId}`);

// Real, populated even before games start — a team's real starters/points
// for one week (see Sleeper Manager's alert engine, lib/managerAlerts.ts).
// Loosely typed like getLeagueRaw; managerSync.ts casts to the narrow
// SleeperMatchupRow shape it actually reads.
export const getMatchups = (leagueId: string, week: number) =>
  jget<Record<string, unknown>[]>(`${S}/league/${leagueId}/matchups/${week}`);

export const getDraft = (draftId: string) =>
  jget<Record<string, unknown>>(`${S}/draft/${draftId}`);

// Real trade/waiver/free-agent activity for one league, filed under the
// week ("round"/"leg") it was created — see Portfolio's trade inbox
// (lib/usePortfolio.ts), which scans a small window of recent legs rather
// than every week of the season for performance.
export const getTransactions = (leagueId: string, round: number) =>
  jget<SleeperTransaction[]>(`${S}/league/${leagueId}/transactions/${round}`);

export const today = () => new Date().toISOString().slice(0, 10);

const PLAYERS_CACHE_KEY = "fantis_players_nfl_v3";

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
      injBodyPart: p.injury_body_part,
      injNotes: p.injury_notes,
      practiceStatus: p.practice_participation,
      newsUpdated: p.news_updated,
      espnId: p.espn_id,
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

// Player headshot (distinct from avatar() above, which is for
// league/team avatars) — same real URL already used in production at
// components/Portfolio.tsx, pulled out here so new call sites don't
// duplicate the string.
export const playerPhotoUrl = (playerId: string) =>
  `https://sleepercdn.com/content/nfl/players/${playerId}.jpg`;

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
    map[id] = {
      adp_dd_ppr: p.adp_dd_ppr,
      pts_ppr: p.pts_ppr,
      pts_half_ppr: p.pts_half_ppr,
      pts_std: p.pts_std,
    };
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

  // Fetched concurrently, not week-by-week — 18 sequential awaits measured
  // ~7.3s real end-to-end on a cold cache; Sleeper's public read API has no
  // documented rate limit to throttle against (same conclusion
  // managerSync.ts's DETAIL_BATCH_SIZE comment already reached), so all 18
  // fire at once. onProgress reports completion COUNT, not week number,
  // since completion order is no longer guaranteed once concurrent.
  const weeks = Array.from({ length: SEASON_WEEKS }, (_, i) => i + 1);
  let completed = 0;
  const responses = await Promise.all(
    weeks.map((week) =>
      jget<Record<string, RawWeeklyProjection | null>>(
        `${S}/projections/nfl/regular/${season}/${week}`
      ).then((raw) => {
        onProgress?.(++completed, SEASON_WEEKS);
        return raw;
      })
    )
  );

  const totals: Record<string, SeasonProjectionTotal> = {};
  for (const raw of responses) {
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

// Seasons with a full, real game log available (excludes the current/live
// season, which won't have 18 completed weeks yet). Verified real data as
// far back as 2019 via Sleeper's /stats endpoint; capped at 2020 per product
// decision rather than the data's actual limit.
export const HISTORICAL_SEASONS = ["2025", "2024", "2023", "2022", "2021", "2020"];

interface RawWeekStat {
  pts_ppr?: number;
  pos_rank_ppr?: number;
  off_snp?: number;
  tm_off_snp?: number;
  pass_att?: number;
  pass_yd?: number;
  pass_td?: number;
  pass_int?: number;
  pass_rz_att?: number;
  rush_att?: number;
  rush_yd?: number;
  rush_td?: number;
  rush_rz_att?: number;
  rec_tgt?: number;
  rec?: number;
  rec_yd?: number;
  rec_td?: number;
  rec_ypt?: number;
  rec_rz_tgt?: number;
}

export interface WeeklyStatLine {
  week: number;
  pts: number | null;
  posRank: number | null;
  snapPct: number | null;
  passAtt: number | null;
  passYd: number | null;
  passTd: number | null;
  passInt: number | null;
  passRzAtt: number | null;
  rushAtt: number | null;
  rushYd: number | null;
  rushTd: number | null;
  rushRzAtt: number | null;
  recTgt: number | null;
  rec: number | null;
  recYd: number | null;
  recTd: number | null;
  recYpt: number | null;
  recRzTgt: number | null;
  targetSharePct: number | null;
  rushSharePct: number | null;
}

// One real week's full stat payload (~500KB) is too large to keep in
// localStorage per-player-per-week across every player, so this cache is
// in-memory only — fast for repeat lookups within a session (switching
// between players' Logs tabs), gone on reload. Not persisted like the
// other caches in this file, deliberately.
const rawWeekCache = new Map<string, Record<string, RawWeekStat>>();

async function getRawWeekStats(season: string, week: number): Promise<Record<string, RawWeekStat>> {
  const key = `${season}_${week}`;
  const cached = rawWeekCache.get(key);
  if (cached) return cached;
  const raw = await jget<Record<string, RawWeekStat | null>>(
    `${S}/stats/nfl/regular/${season}/${week}`
  );
  const cleaned: Record<string, RawWeekStat> = {};
  for (const id in raw) if (raw[id]) cleaned[id] = raw[id]!;
  rawWeekCache.set(key, cleaned);
  return cleaned;
}

// A real per-game log for one player across a season — actual box-score
// stats (not projections), including target share computed by summing every
// teammate's real targets that same week (not a separate/approximated
// source). Team composition for that sum comes from the player's *current*
// roster (Sleeper doesn't expose historical team-by-week), so this is
// slightly approximate for anyone who's since changed teams — real numbers,
// just not perfectly time-accurate for a traded player's target share.
export async function getPlayerGameLog(playerId: string, season: string): Promise<WeeklyStatLine[]> {
  const pmap = await getPlayers();
  const team = pmap[playerId]?.t;
  // Target share only makes sense among pass-catchers — restrict the
  // denominator to same-position teammates plus RBs (who also see targets),
  // not the whole 53-man roster.
  const targetShareIds = team
    ? Object.keys(pmap).filter(
        (id) => pmap[id].t === team && ["WR", "TE", "RB"].includes(pmap[id].p)
      )
    : [];
  // Carry share has no position restriction — a QB scramble or WR jet sweep
  // still counts as a team carry, so the denominator is every player on the
  // roster, not just RBs. Same current-roster caveat as target share above.
  const teamIds = team ? Object.keys(pmap).filter((id) => pmap[id].t === team) : [];

  const lines: WeeklyStatLine[] = [];
  for (let week = 1; week <= SEASON_WEEKS; week++) {
    const weekStats = await getRawWeekStats(season, week);
    const s = weekStats[playerId];
    let teamTargets = 0;
    for (const tid of targetShareIds) teamTargets += weekStats[tid]?.rec_tgt ?? 0;
    let teamCarries = 0;
    for (const tid of teamIds) teamCarries += weekStats[tid]?.rush_att ?? 0;

    // Sleeper's raw payload omits a counting stat entirely when it's zero
    // (confirmed directly: a real 16-carry, 0-TD game has no `rush_td` key
    // at all) rather than sending 0 — so "field missing" only means "really
    // didn't happen" when the player has a stat line (`s`) at all. When `s`
    // itself is missing, that's a genuine DNP and stays null throughout.
    const count = (v: number | undefined) => (s ? (v ?? 0) : null);

    lines.push({
      week,
      pts: s?.pts_ppr ?? null,
      posRank: s?.pos_rank_ppr ?? null,
      snapPct: s?.off_snp != null && s?.tm_off_snp ? (s.off_snp / s.tm_off_snp) * 100 : null,
      passAtt: count(s?.pass_att),
      passYd: count(s?.pass_yd),
      passTd: count(s?.pass_td),
      passInt: count(s?.pass_int),
      passRzAtt: count(s?.pass_rz_att),
      rushAtt: count(s?.rush_att),
      rushYd: count(s?.rush_yd),
      rushTd: count(s?.rush_td),
      rushRzAtt: count(s?.rush_rz_att),
      recTgt: count(s?.rec_tgt),
      rec: count(s?.rec),
      recYd: count(s?.rec_yd),
      recTd: count(s?.rec_td),
      recYpt: s?.rec_ypt ?? null,
      recRzTgt: count(s?.rec_rz_tgt),
      targetSharePct: s?.rec_tgt != null && teamTargets > 0 ? (s.rec_tgt / teamTargets) * 100 : null,
      rushSharePct: s?.rush_att != null && teamCarries > 0 ? (s.rush_att / teamCarries) * 100 : null,
    });
  }
  return lines;
}
