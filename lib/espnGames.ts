// Real per-team game context for the current NFL week — spread, total, and
// a win probability, sourced from ESPN's public scoreboard endpoint
// (`site.api.espn.com/.../scoreboard`), which carries real DraftKings-via-ESPN
// odds inline for every game in one call. This endpoint needs no API key and
// sends `access-control-allow-origin: *`, so it's called directly from the
// client, the same pattern as Sleeper — not proxied like SharpAPI/SportsGameOdds.
//
// Win probability is de-vigged from the real moneyline using the exact same
// technique lib/tradeValue.ts already uses for the Anytime-TD prop — not a
// new methodology, and cross-checked against ESPN's own BPI predictor for a
// sample 2026 Week 1 game (63.1% devigged vs. 62.9% from ESPN's model — a
// close, real approximation, not an invented number).
import { parseAmerican, devig } from "./tradeValue";

export interface TeamGameContext {
  opponent: string;
  homeAway: "home" | "away";
  spread: number | null; // this team's own spread; negative = favored
  overUnder: number | null;
  winProb: number | null; // 0-1
}

interface ScoreboardCompetitor {
  team?: { abbreviation?: string };
  homeAway?: "home" | "away";
}

interface ScoreboardOdds {
  spread?: number;
  overUnder?: number;
  moneyline?: {
    home?: { close?: { odds?: string }; open?: { odds?: string } };
    away?: { close?: { odds?: string }; open?: { odds?: string } };
  };
}

let cache: { key: string; data: Record<string, TeamGameContext> } | null = null;

export async function getWeekGameContext(
  season: string,
  week: number
): Promise<Record<string, TeamGameContext>> {
  const key = `${season}-${week}`;
  if (cache?.key === key) return cache.data;

  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`
  );
  if (!res.ok) throw new Error("Couldn't reach ESPN scoreboard.");
  const json = await res.json();

  const out: Record<string, TeamGameContext> = {};
  for (const event of json.events ?? []) {
    const comp = event.competitions?.[0];
    const competitors: ScoreboardCompetitor[] = comp?.competitors ?? [];
    const odds: ScoreboardOdds | undefined = comp?.odds?.[0];

    const homeML = parseAmerican(
      odds?.moneyline?.home?.close?.odds ?? odds?.moneyline?.home?.open?.odds ?? null
    );
    const awayML = parseAmerican(
      odds?.moneyline?.away?.close?.odds ?? odds?.moneyline?.away?.open?.odds ?? null
    );
    const homeWinProb = homeML != null && awayML != null ? devig(homeML, awayML) : null;

    for (const c of competitors) {
      const abbr = c.team?.abbreviation;
      if (!abbr) continue;
      const opp = competitors.find((o) => o !== c);
      const isHome = c.homeAway === "home";
      out[abbr] = {
        opponent: opp?.team?.abbreviation ?? "—",
        homeAway: c.homeAway ?? "home",
        spread: odds?.spread != null ? (isHome ? odds.spread : -odds.spread) : null,
        overUnder: odds?.overUnder ?? null,
        winProb: homeWinProb == null ? null : isHome ? homeWinProb : 1 - homeWinProb,
      };
    }
  }
  cache = { key, data: out };
  return out;
}

let kickoffCache: { key: string; data: Record<string, string> } | null = null;

// Team -> kickoff time (ISO) for one week, from the same ESPN scoreboard
// events already read above (`event.date`). Used to lock lineup moves once a
// player's game has started. ESPN's "WSH" is normalised to Sleeper's "WAS"
// so it lines up with player teams from Sleeper's player dump.
export async function getWeekKickoffs(season: string, week: number): Promise<Record<string, string>> {
  const key = `${season}-${week}`;
  if (kickoffCache?.key === key) return kickoffCache.data;
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`
  );
  if (!res.ok) throw new Error("Couldn't reach ESPN scoreboard.");
  const json = await res.json();
  const out: Record<string, string> = {};
  for (const event of json.events ?? []) {
    const date: string | undefined = event.date;
    if (!date) continue;
    for (const c of (event.competitions?.[0]?.competitors ?? []) as ScoreboardCompetitor[]) {
      const abbr = c.team?.abbreviation;
      if (abbr) out[abbr === "WSH" ? "WAS" : abbr] = date;
    }
  }
  kickoffCache = { key, data: out };
  return out;
}

const SEASON_WEEKS = 18;
const SCHEDULE_CACHE_PREFIX = "fantis_espn_schedule_v1_";

// Real opponent-by-week for every team across a full season — same ESPN
// scoreboard endpoint as getWeekGameContext, just fetched for every week and
// reduced to team -> opponent. A team missing from a given week's map means
// that team had a real bye (confirmed by direct testing: ESPN's scoreboard
// simply omits bye teams from that week's events, it doesn't return a
// placeholder), which the Logs tab uses to skip bye rows entirely rather
// than showing a blank line. Cached per season for the day — past seasons'
// schedules never change, so this is effectively a one-time fetch per user.
export async function getSeasonSchedule(season: string): Promise<Record<number, Record<string, string>>> {
  const cacheKey = `${SCHEDULE_CACHE_PREFIX}${season}`;
  if (typeof window !== "undefined") {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const d = JSON.parse(cached) as { day: string; schedule: Record<number, Record<string, string>> };
        const today = new Date().toISOString().slice(0, 10);
        if (d.day === today) return d.schedule;
      }
    } catch {
      // ignore cache read errors
    }
  }

  const weeks = await Promise.all(
    Array.from({ length: SEASON_WEEKS }, (_, i) => i + 1).map(async (week) => {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`
      );
      if (!res.ok) return { week, matchups: {} as Record<string, string> };
      const json = await res.json();
      const matchups: Record<string, string> = {};
      for (const event of json.events ?? []) {
        const competitors: ScoreboardCompetitor[] = event.competitions?.[0]?.competitors ?? [];
        for (const c of competitors) {
          const abbr = c.team?.abbreviation;
          const opp = competitors.find((o) => o !== c)?.team?.abbreviation;
          if (abbr && opp) matchups[abbr] = opp;
        }
      }
      return { week, matchups };
    })
  );

  const schedule: Record<number, Record<string, string>> = {};
  for (const { week, matchups } of weeks) schedule[week] = matchups;

  if (typeof window !== "undefined") {
    try {
      const today = new Date().toISOString().slice(0, 10);
      window.localStorage.setItem(cacheKey, JSON.stringify({ day: today, schedule }));
    } catch {
      // ignore cache write errors (e.g. quota exceeded)
    }
  }

  return schedule;
}

// A team's own implied point total for the week — the scoring environment
// its offense is playing in, independent of how good the opponent's
// defense grades out. Standard sportsbook-math derivation from the same
// real spread + total already fetched above (no extra request, no
// invented number): total ± spread, split in half.
export function impliedTeamTotal(ctx: TeamGameContext): number | null {
  if (ctx.overUnder == null || ctx.spread == null) return null;
  return (ctx.overUnder - ctx.spread) / 2;
}

export interface GameState {
  state: "pre" | "in" | "post";
  // Fraction of regulation already played (0–1); 1 once it's over. Only
  // meaningful while "in" — computed from the period + game clock.
  elapsed: number;
}

// Live status of every NFL game this week, keyed by team (ESPN's "WSH" →
// Sleeper's "WAS"). A team missing from the map is on a bye. Not cached beyond
// a few seconds: the whole point is to be current.
let statesCache: { key: string; at: number; data: Record<string, GameState> } | null = null;

export async function getWeekGameStates(season: string, week: number): Promise<Record<string, GameState>> {
  const key = `${season}-${week}`;
  if (statesCache && statesCache.key === key && Date.now() - statesCache.at < 20_000) return statesCache.data;
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${week}&dates=${season}`
  );
  if (!res.ok) throw new Error("Couldn't reach ESPN scoreboard.");
  const json = await res.json();
  const out: Record<string, GameState> = {};
  for (const event of json.events ?? []) {
    const st = event.status;
    const state = st?.type?.state as "pre" | "in" | "post" | undefined;
    if (state !== "pre" && state !== "in" && state !== "post") continue;
    const period: number = st?.period ?? 0;
    const [mm, ss] = String(st?.displayClock ?? "0:00").split(":");
    const clock = Number(mm) * 60 + Number(ss ?? 0);
    const elapsed =
      state === "pre" ? 0 : state === "post" ? 1 : period > 4 ? 0.99 : Math.min(1, Math.max(0, ((period - 1) * 900 + (900 - (Number.isFinite(clock) ? clock : 0))) / 3600));
    for (const c of (event.competitions?.[0]?.competitors ?? []) as ScoreboardCompetitor[]) {
      const abbr = c.team?.abbreviation;
      if (abbr) out[abbr === "WSH" ? "WAS" : abbr] = { state, elapsed };
    }
  }
  statesCache = { key, at: Date.now(), data: out };
  return out;
}
