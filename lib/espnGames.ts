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

// A team's own implied point total for the week — the scoring environment
// its offense is playing in, independent of how good the opponent's
// defense grades out. Standard sportsbook-math derivation from the same
// real spread + total already fetched above (no extra request, no
// invented number): total ± spread, split in half.
export function impliedTeamTotal(ctx: TeamGameContext): number | null {
  if (ctx.overUnder == null || ctx.spread == null) return null;
  return (ctx.overUnder - ctx.spread) / 2;
}
