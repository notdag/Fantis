// Per-team, per-position roster strength: summed trade value at QB/RB/WR/TE,
// and each team's rank at that position within the league. Shared by
// LeagueView's full team breakdown and TeamHub's "your team" summary so the
// two definitions of "strong at a position" never drift apart.
import type { LeagueBundle } from "./types";
import type { TradeValueResult } from "./tradeValue";
import { stripSuffix } from "./playerIdMap";

export const POWER_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export interface TeamPower {
  scoreByPos: Record<string, number>;
  rankByPos: Record<string, number>;
  total: number;
}

export function computeTeamPower(
  bundle: LeagueBundle,
  values: Record<string, TradeValueResult>
): Record<number, TeamPower> {
  const scoreByTeam: Record<number, Record<string, number>> = {};
  for (const t of bundle.teams) {
    const byPos: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const id of t.players) {
      const p = bundle.pmap[id];
      if (!p || !(p.p in byPos)) continue;
      const val = values[p.n] ?? values[stripSuffix(p.n)];
      byPos[p.p] += val?.value ?? 0;
    }
    scoreByTeam[t.rid] = byPos;
  }

  const rankByTeam: Record<number, Record<string, number>> = {};
  for (const pos of POWER_POSITIONS) {
    const scored = bundle.teams
      .map((t) => ({ rid: t.rid, score: scoreByTeam[t.rid][pos] }))
      .sort((a, b) => b.score - a.score);
    scored.forEach((s, i) => {
      (rankByTeam[s.rid] ??= {})[pos] = i + 1;
    });
  }

  const out: Record<number, TeamPower> = {};
  for (const t of bundle.teams) {
    const byPos = scoreByTeam[t.rid];
    out[t.rid] = {
      scoreByPos: byPos,
      rankByPos: rankByTeam[t.rid] ?? {},
      total: POWER_POSITIONS.reduce((sum, pos) => sum + byPos[pos], 0),
    };
  }
  return out;
}
