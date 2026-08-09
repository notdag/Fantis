// Two real, derived per-player stats computed from Sleeper's actual weekly
// box scores (lib/sleeper.ts's getPlayerGameLog) — not projections, not
// hand-tuned. Both replace what would otherwise be a manually-curated,
// analyst-judgment call with an objective rule anyone can re-derive from
// the same public data.
import type { WeeklyStatLine } from "./sleeper";

const REC_POINTS = 1; // full PPR
const YARD_POINTS = 0.1; // rush or rec yd, matches lib/tradeValue.ts's scale
const TD_POINTS = 6; // rush or rec TD, matches lib/tradeValue.ts's scale

// A game only "counts" toward Adjusted PPG if the player's snap share that
// week was at least half of their own median snap share for the season —
// self-calibrated per player rather than one fixed cutoff for every
// position, so a committee RB and a bellcow WR aren't held to the same
// snap floor. This is what stands in for a human analyst's "in complete
// games" / "as starter" annotations: an objective, reproducible rule
// instead of a per-player judgment call.
const FULL_ROLE_SNAP_FRACTION = 0.5;
const MIN_FULL_ROLE_GAMES = 3;

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface AdjustedPpgResult {
  ppg: number;
  gamesUsed: number;
  gamesExcluded: number;
}

// null means there isn't enough real data to compute this responsibly
// (too few full-role games), not zero.
export function computeAdjustedPpg(lines: WeeklyStatLine[]): AdjustedPpgResult | null {
  const played = lines.filter((l) => l.pts != null);
  const withSnaps = played.filter((l) => l.snapPct != null);
  if (withSnaps.length === 0) return null;

  const floor = median(withSnaps.map((l) => l.snapPct!)) * FULL_ROLE_SNAP_FRACTION;
  const full = withSnaps.filter((l) => l.snapPct! >= floor);
  if (full.length < MIN_FULL_ROLE_GAMES) return null;

  const total = full.reduce((sum, l) => sum + (l.pts ?? 0), 0);
  return {
    ppg: total / full.length,
    gamesUsed: full.length,
    gamesExcluded: played.length - full.length,
  };
}

export interface ReceptionShareResult {
  pct: number;
  gamesUsed: number;
}

// What share of a player's real fantasy points came from receiving
// (catches + receiving yards + receiving TDs) vs. everything else — real
// box-score components divided by Sleeper's own real pts_ppr total, no
// assumptions beyond the standard full-PPR scale already documented in
// lib/tradeValue.ts.
export function computeReceptionPointShare(lines: WeeklyStatLine[]): ReceptionShareResult | null {
  const played = lines.filter((l) => l.pts != null);
  if (played.length === 0) return null;

  let recPts = 0;
  let totalPts = 0;
  for (const l of played) {
    recPts += (l.rec ?? 0) * REC_POINTS + (l.recYd ?? 0) * YARD_POINTS + (l.recTd ?? 0) * TD_POINTS;
    totalPts += l.pts ?? 0;
  }
  if (totalPts <= 0) return null;
  return { pct: (recPts / totalPts) * 100, gamesUsed: played.length };
}

export interface RedZoneUsageResult {
  perGame: number;
  gamesUsed: number;
}

// Real red-zone/goal-to-go opportunity per game — scoring-range touches,
// which predict TDs far better than raw yardage. What counts as "the"
// red-zone number is position-dependent: a QB's is pass attempts inside
// the 20, an RB's is rush attempts + red-zone targets (pass-catching
// backs get value both ways), a WR/TE's is red-zone targets. All three
// fields (pass_rz_att, rush_rz_att, rec_rz_tgt) come straight from
// Sleeper's real box score — nothing derived or estimated.
export function computeRedZoneUsage(lines: WeeklyStatLine[], pos: string): RedZoneUsageResult | null {
  const played = lines.filter((l) => l.pts != null);
  if (played.length === 0) return null;

  const perLine = (l: WeeklyStatLine): number => {
    if (pos === "QB") return l.passRzAtt ?? 0;
    if (pos === "RB") return (l.rushRzAtt ?? 0) + (l.recRzTgt ?? 0);
    return l.recRzTgt ?? 0; // WR/TE
  };

  const total = played.reduce((sum, l) => sum + perLine(l), 0);
  return { perGame: total / played.length, gamesUsed: played.length };
}
