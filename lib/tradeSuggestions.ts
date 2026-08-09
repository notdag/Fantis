// Suggested trades: find other teams in the league that are genuinely thin
// at RB or WR (real bench depth, not just aggregate points), and match them
// against your own real bench surplus at that position — offering back
// whichever of RB/WR they're deepest in and you're thinnest in.
//
// Scoped to RB/WR on purpose (this is the same lesson learned building the
// manual version of this analysis): QB season point totals run far higher
// than RB/WR in any PPR format, so a QB-for-RB swap always looks lopsided
// in Fantis's point-based trade value regardless of whether it's actually
// fair. RB and WR sit on a comparable point scale, so a straight value
// comparison between them is actually meaningful.
//
// "Need" is based on real roster construction, not just point totals: a
// team's bench at a position is whatever's left over after filling this
// league's actual starting lineup (via the same optimal-lineup heuristic
// lib/byeImpact.ts already uses) — a team with zero or weak bench depth at
// a position has a real, structural need there, independent of how good
// their current starter happens to be.
import { computeOptimalLineup } from "./byeImpact";
import { buildStartingSlots } from "./rosterSlots";
import { stripSuffix } from "./playerIdMap";
import type { LeagueBundle, Team } from "./types";
import type { TradeValueResult } from "./tradeValue";

export const TRADE_POSITIONS = ["RB", "WR"] as const;
export type TradePosition = (typeof TRADE_POSITIONS)[number];

export interface RosterPlayerLite {
  id: string;
  name: string;
  pos: string;
  team: string;
  value: number;
}

interface TeamBenchProfile {
  rid: number;
  name: string;
  benchByPos: Record<TradePosition, RosterPlayerLite[]>; // desc value, starters excluded
  benchValueByPos: Record<TradePosition, number>;
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

function buildBenchProfile(
  bundle: LeagueBundle,
  team: Team,
  values: Record<string, TradeValueResult>
): TeamBenchProfile {
  const roster = buildRoster(bundle, team.players, values);
  const slots = buildStartingSlots(bundle.rosterPositions);
  const lineup = computeOptimalLineup(slots, roster);
  const starterIds = new Set(
    Object.values(lineup)
      .filter((p): p is RosterPlayerLite => p != null)
      .map((p) => p.id)
  );

  const benchByPos = {} as Record<TradePosition, RosterPlayerLite[]>;
  const benchValueByPos = {} as Record<TradePosition, number>;
  for (const pos of TRADE_POSITIONS) {
    const bench = roster
      .filter((p) => p.pos === pos && !starterIds.has(p.id))
      .sort((a, b) => b.value - a.value);
    benchByPos[pos] = bench;
    benchValueByPos[pos] = bench.reduce((s, p) => s + p.value, 0);
  }
  return { rid: team.rid, name: team.name, benchByPos, benchValueByPos };
}

export interface TradeSuggestion {
  partnerRid: number;
  partnerName: string;
  give: RosterPlayerLite; // yours, at your surplus position
  givePos: TradePosition;
  receive: RosterPlayerLite; // theirs, at your need position
  receivePos: TradePosition;
}

// A suggestion only ships if the fairest available pairing is within this
// much of each other's value — otherwise it's not a realistic trade either
// side would accept, just a lopsided one that happens to satisfy the
// need/surplus check.
const FAIRNESS_TOLERANCE = 0.35;

export function findTradeSuggestions(
  bundle: LeagueBundle,
  myRid: number,
  values: Record<string, TradeValueResult>
): TradeSuggestion[] {
  const profiles = bundle.teams.map((t) => buildBenchProfile(bundle, t, values));
  const me = profiles.find((p) => p.rid === myRid);
  if (!me) return [];

  const suggestions: TradeSuggestion[] = [];

  for (const surplusPos of TRADE_POSITIONS) {
    const needPos: TradePosition = surplusPos === "RB" ? "WR" : "RB";
    const myBench = me.benchByPos[surplusPos];
    // Need at least 2 spare bodies here to have one worth trading away
    // without giving up your only real depth at the position.
    if (myBench.length < 2) continue;
    // This has to actually be a surplus, not just "also thin" — only offer
    // it if you're deeper here than at the position you'd want back.
    if (me.benchValueByPos[surplusPos] <= me.benchValueByPos[needPos]) continue;
    // Keep your single best bench piece as insurance when you have 3+.
    const offerPool = myBench.length >= 3 ? myBench.slice(1) : myBench;

    const partners = profiles
      .filter((p) => p.rid !== myRid)
      .filter((p) => p.benchValueByPos[surplusPos] < me.benchValueByPos[surplusPos]) // genuinely thinner than you here
      .filter((p) => p.benchByPos[needPos].length > 0) // has something real to send back
      .sort((a, b) => a.benchValueByPos[surplusPos] - b.benchValueByPos[surplusPos]); // neediest first

    // Try partners neediest-first, but only take the first one where the
    // *fairest possible pairing* between your spares and their bench is
    // actually close in value — a real trade, not a steal.
    for (const partner of partners) {
      let best: { give: RosterPlayerLite; receive: RosterPlayerLite; gap: number } | null = null;
      for (const give of offerPool) {
        for (const receive of partner.benchByPos[needPos]) {
          const gap = Math.abs(give.value - receive.value) / Math.max(give.value, receive.value, 1);
          if (!best || gap < best.gap) best = { give, receive, gap };
        }
      }
      if (best && best.gap <= FAIRNESS_TOLERANCE) {
        suggestions.push({
          partnerRid: partner.rid,
          partnerName: partner.name,
          give: best.give,
          givePos: surplusPos,
          receive: best.receive,
          receivePos: needPos,
        });
        break;
      }
    }
  }

  return suggestions;
}
