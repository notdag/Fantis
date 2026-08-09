// Bye Week Planner: for each week, does this team's real starting lineup
// lose a starter to a bye, and does the bench actually cover it? Built
// entirely from data already in the app — real 2026 bye weeks
// (lib/byeWeeks.ts), the league's real roster_positions (rosterSlots.ts),
// and the same trade-value methodology used everywhere else (lib/tradeValue.ts)
// to decide who the "starters" are and who's the best bench replacement.
// No simulated matchups, no invented win probabilities.
import { BYE_WEEKS_2026 } from "./byeWeeks";
import { buildStartingSlots, eligiblePositions, type StartingSlot } from "./rosterSlots";
import { stripSuffix } from "./playerIdMap";
import type { LeagueBundle } from "./types";
import type { TradeValueResult } from "./tradeValue";

export interface RosterPlayerLite {
  id: string;
  name: string;
  pos: string;
  team: string;
  value: number;
}

export interface ByeAffectedSlot {
  slot: StartingSlot;
  player: RosterPlayerLite;
  replacement: RosterPlayerLite | null;
}

export interface WeekByeImpact {
  week: number;
  affected: ByeAffectedSlot[];
  severity: "covered" | "moderate" | "severe";
}

function buildRoster(
  bundle: LeagueBundle,
  playerIds: string[],
  values: Record<string, TradeValueResult>
): RosterPlayerLite[] {
  const out: RosterPlayerLite[] = [];
  for (const id of playerIds) {
    const p = bundle.pmap[id];
    if (!p) continue;
    const val = values[p.n] ?? values[stripSuffix(p.n)];
    out.push({ id, name: p.n, pos: p.p, team: p.t, value: val?.value ?? 0 });
  }
  return out;
}

// Greedy "who would actually start" fill: most-restrictive slots (single
// position) filled before flex slots, highest real trade value first —
// the same heuristic a manual Start/Sit pass would land on, automated.
export function computeOptimalLineup(
  slots: StartingSlot[],
  roster: RosterPlayerLite[]
): Record<string, RosterPlayerLite | null> {
  const sortedSlots = [...slots].sort(
    (a, b) => eligiblePositions(a.code).length - eligiblePositions(b.code).length
  );
  const used = new Set<string>();
  const lineup: Record<string, RosterPlayerLite | null> = {};
  for (const slot of sortedSlots) {
    const eligible = eligiblePositions(slot.code);
    const pick =
      roster
        .filter((p) => eligible.includes(p.pos) && !used.has(p.id))
        .sort((a, b) => b.value - a.value)[0] ?? null;
    lineup[slot.key] = pick;
    if (pick) used.add(pick.id);
  }
  return lineup;
}

export function computeByeImpact(
  bundle: LeagueBundle,
  playerIds: string[],
  values: Record<string, TradeValueResult>
): WeekByeImpact[] {
  const roster = buildRoster(bundle, playerIds, values);
  const slots = buildStartingSlots(bundle.rosterPositions);
  const lineup = computeOptimalLineup(slots, roster);
  const starterIds = new Set(
    Object.values(lineup)
      .filter((p): p is RosterPlayerLite => p != null)
      .map((p) => p.id)
  );
  const bench = roster.filter((p) => !starterIds.has(p.id));

  const weeks: WeekByeImpact[] = [];
  for (let week = 1; week <= 18; week++) {
    const affected: ByeAffectedSlot[] = [];
    const usedBench = new Set<string>();
    for (const slot of slots) {
      const starter = lineup[slot.key];
      if (!starter || BYE_WEEKS_2026[starter.team] !== week) continue;
      const eligible = eligiblePositions(slot.code);
      const replacement =
        bench
          .filter(
            (p) =>
              eligible.includes(p.pos) && !usedBench.has(p.id) && BYE_WEEKS_2026[p.team] !== week
          )
          .sort((a, b) => b.value - a.value)[0] ?? null;
      if (replacement) usedBench.add(replacement.id);
      affected.push({ slot, player: starter, replacement });
    }
    if (affected.length === 0) continue;
    const uncovered = affected.filter((a) => !a.replacement).length;
    const severity: WeekByeImpact["severity"] =
      uncovered === 0 ? "covered" : uncovered === 1 ? "moderate" : "severe";
    weeks.push({ week, affected, severity });
  }
  return weeks;
}
