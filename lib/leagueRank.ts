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
  wins?: number;
  losses?: number;
  ties?: number;
  fpts?: number | null;
  fptsAgainst?: number | null;
  teamName?: string | null;
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

export interface StandingResult {
  standing: number | null; // 1 = best real record; null if myRosterId isn't in rosters
  totalTeams: number;
}

// Real win% tiebreak: (wins + ties*0.5) / games, the same convention
// already used by MyTeams.tsx's winPct() and ManagerDashboard.tsx's
// portfolio win% calc — reused here, not reinvented. Teams with zero
// games played sort last (same "unplayed sorts to bottom" treatment
// those two already give a -1 winPct), not falsely tied at the top with
// a real 0-win record.
function winPct(r: LeagueRosterRow): number {
  const games = (r.wins ?? 0) + (r.losses ?? 0) + (r.ties ?? 0);
  return games === 0 ? -1 : ((r.wins ?? 0) + (r.ties ?? 0) * 0.5) / games;
}

// Real record-based order for a league's standings: win% desc, then real
// season points-for desc as a tiebreak between identical records. Shared
// by computeStanding() below and LeagueDetail.tsx's Standings table so
// both use exactly the same sort, never two independently-drifting ones.
export function sortByStanding(rosters: LeagueRosterRow[]): LeagueRosterRow[] {
  return [...rosters].sort((a, b) => {
    const pctDiff = winPct(b) - winPct(a);
    if (pctDiff !== 0) return pctDiff;
    return (b.fpts ?? 0) - (a.fpts ?? 0);
  });
}

export function computeStanding(rosters: LeagueRosterRow[], myRosterId: number): StandingResult {
  if (rosters.length === 0) return { standing: null, totalTeams: 0 };
  const sorted = sortByStanding(rosters);
  const idx = sorted.findIndex((r) => r.rosterId === myRosterId);
  return {
    standing: idx >= 0 ? idx + 1 : null,
    totalTeams: rosters.length,
  };
}
