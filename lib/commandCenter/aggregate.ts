// Cross-league aggregation: turn N per-league answers into "the same 3 players
// keep coming up" so 200 leagues don't have to be read one at a time.
import type { AvailState, DropAnalysis, LeagueResult } from "./types";
import { STATE_ORDER } from "./types";

export function countStates(results: LeagueResult[]): Record<AvailState, number> {
  const c = Object.fromEntries(STATE_ORDER.map((s) => [s, 0])) as Record<AvailState, number>;
  for (const r of results) c[r.state]++;
  return c;
}

export interface DropTally {
  playerId: string;
  name: string;
  pos: string;
  count: number;
  leagueIds: string[];
}

// How often each player appears in the bottom-N across the given leagues,
// most frequent first.
export function tallyDrops(analyses: DropAnalysis[]): DropTally[] {
  const m = new Map<string, DropTally>();
  for (const a of analyses) {
    for (const c of a.candidates) {
      const t = m.get(c.playerId) ?? { playerId: c.playerId, name: c.name, pos: c.pos, count: 0, leagueIds: [] };
      t.count++;
      t.leagueIds.push(a.leagueId);
      m.set(c.playerId, t);
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const leaguesWhereCandidate = (analyses: DropAnalysis[], playerId: string): string[] =>
  analyses.filter((a) => a.candidates.some((c) => c.playerId === playerId)).map((a) => a.leagueId);
