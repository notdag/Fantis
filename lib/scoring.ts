// Turns a league's real settings into what Start/Sit needs: the right
// projected-points number for this league's reception scoring, and a
// readable summary of its starting lineup shape.
import type { SleeperProjectionEntry } from "./types";

// Sleeper's projections already include three precomputed point totals —
// pts_std, pts_half_ppr, pts_ppr — for reception values of exactly 0, 0.5,
// and 1. Most leagues use one of those three. For anything else (0.25,
// TE-premium bonuses, etc.) this linearly interpolates between std and
// full PPR using the league's real rec value — a documented approximation,
// not an exact match for custom bonus categories Sleeper doesn't expose a
// precomputed total for.
export function pointsForScoring(
  entry: SleeperProjectionEntry | null | undefined,
  scoringRec: number
): number | null {
  if (!entry) return null;
  if (scoringRec <= 0) return entry.pts_std ?? entry.pts_ppr ?? null;
  if (scoringRec === 0.5 && entry.pts_half_ppr != null) return entry.pts_half_ppr;
  if (scoringRec >= 1) return entry.pts_ppr ?? entry.pts_std ?? null;
  if (entry.pts_std != null && entry.pts_ppr != null) {
    return entry.pts_std + scoringRec * (entry.pts_ppr - entry.pts_std);
  }
  return entry.pts_ppr ?? entry.pts_std ?? null;
}

export function scoringLabel(scoringRec: number): string {
  if (scoringRec <= 0) return "Standard";
  if (scoringRec >= 1) return "Full PPR";
  if (scoringRec === 0.5) return "Half PPR";
  return `${scoringRec} PPR`;
}

// "QB, 2 RB, 2 WR, TE, 3 FLEX" — starting slots only, bench excluded, in
// the order Sleeper lists them, collapsed to counts per slot type.
export function summarizeRosterPositions(rosterPositions: string[]): string {
  const counts: Record<string, number> = {};
  const order: string[] = [];
  for (const slot of rosterPositions) {
    if (slot === "BN") continue;
    if (!(slot in counts)) order.push(slot);
    counts[slot] = (counts[slot] || 0) + 1;
  }
  const LABELS: Record<string, string> = {
    SUPER_FLEX: "SUPERFLEX",
    WRRB_FLEX: "WR/RB FLEX",
    REC_FLEX: "WR/TE FLEX",
    FLEX: "FLEX",
  };
  return order
    .map((slot) => {
      const n = counts[slot];
      const label = LABELS[slot] || slot;
      return n > 1 ? `${n} ${label}` : label;
    })
    .join(", ");
}
