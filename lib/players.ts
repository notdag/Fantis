// Derived helpers over the curated player list. The actual data (tier,
// posRank per player) lives in lib/players.data.ts, which the owner-only
// /admin tier board can regenerate — see CLAUDE.md "Known limitations".
import type { Player } from "./types";
import { RAW } from "./players.data";

export const PLAYERS: Player[] = RAW.map(([name, pos, team, tier, posRank]) => ({
  name,
  pos,
  team,
  tier,
  posRank,
}));

export const POS_COLOR: Record<string, string> = {
  QB: "var(--qb)",
  RB: "var(--rb)",
  WR: "var(--wr)",
  TE: "var(--te)",
  K: "var(--oth)",
  DEF: "var(--oth)",
};

// Soft "chip" treatment for position badges: tinted background + border
// derived from the position's own color via color-mix, text in the full hue.
// Keeps position legible at a glance without a solid saturated fill.
export function posChipStyle(pos: string) {
  const c = POS_COLOR[pos] || POS_COLOR.DEF;
  return {
    color: c,
    background: `color-mix(in srgb, ${c} 20%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 52%, transparent)`,
  };
}

// Letter-grade tier labels (S/A/B/.../G) instead of raw numbers — the
// underlying `tier` field on Player is still just 1-8 (index + 1) so
// lib/players.data.ts, the save route, and computePosRanks don't need to
// know about labels at all; this is purely a display mapping.
export const TIER_LABELS = ["S", "A", "B", "C", "D", "E", "F", "G"];

export const TIER_COLOR = [
  "#37E0B0",
  "#FFB020",
  "#35B6F0",
  "#F5A742",
  "#B18CFF",
  "#8A9BB5",
  "#E0737A",
  "#6B7280",
];

// Position rank (QB1, RB4, ...) derived from order alone: the Nth player at
// a position, in whatever order they're given, is ranked N at that
// position. The tier board (components/TierBoard.tsx) relies on this to
// turn "master rank order" into posRank live, and the save route uses it to
// bake posRank into lib/players.data.ts.
export function computePosRanks(players: { pos: string }[]): number[] {
  const counts: Record<string, number> = {};
  return players.map((p) => {
    counts[p.pos] = (counts[p.pos] || 0) + 1;
    return counts[p.pos];
  });
}
