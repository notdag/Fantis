// Real league-wide rank + team value, computed from LeagueRoster (every
// team's roster in a league — see prisma/schema.prisma) plus the same real
// season PPR point projections used everywhere else in the app
// (lib/useDropCandidates.ts's useSeasonTotals()). Team value here is
// intentionally simpler than lib/tradeValue.ts's full trade-value
// methodology (season baseline only, no weekly-market blend) — that blend
// needs per-player live prop data, which isn't worth fetching for every
// roster in every league just to compute a rank number. Still entirely
// real, documented Sleeper data; never a fabricated "power score."
export interface LeagueRosterRow {
  rosterId: number;
  ownerId: string | null;
  players: string[];
}

export interface LeagueRankResult {
  rank: number | null; // 1 = highest value; null if myRosterId isn't in rosters or no season data yet
  totalTeams: number;
  myValue: number | null;
}

export function computeLeagueRank(
  rosters: LeagueRosterRow[],
  myRosterId: number,
  seasonTotals: Record<string, { pts: number }> | null
): LeagueRankResult {
  if (!seasonTotals || rosters.length === 0) {
    return { rank: null, totalTeams: rosters.length, myValue: null };
  }
  const valued = rosters.map((r) => ({
    rosterId: r.rosterId,
    value: r.players.reduce((sum, id) => sum + (seasonTotals[id]?.pts ?? 0), 0),
  }));
  valued.sort((a, b) => b.value - a.value);
  const idx = valued.findIndex((r) => r.rosterId === myRosterId);
  return {
    rank: idx >= 0 ? idx + 1 : null,
    totalTeams: rosters.length,
    myValue: idx >= 0 ? valued[idx].value : null,
  };
}
