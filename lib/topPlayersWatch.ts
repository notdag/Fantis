// "Is anyone I care about sitting on the bench?" — pure detection used by the
// Lineups page notice. Watched players = the owner's top-N curated rankings
// (/admin order) plus anyone on the My players priority list. A benched
// watched player is only a PROBLEM if he's healthy and a worse-ranked player
// (or an empty slot) holds a spot he's eligible for; if every eligible spot is
// held by someone ranked at least as well, he's simply behind better players.
import { eligiblePositions } from "./rosterSlots";

export interface WatchLeague {
  leagueId: string;
  leagueName: string;
  slotCodes: string[]; // starting slots in the league's own order (BN excluded)
  starters: string[]; // positional, "0"/"" = empty
  players: string[];
  reserve: string[];
}

export interface WatchOptions {
  topN: number;
  // 0-based position in the owner's overall curated rankings; undefined = unranked.
  rankOrder: (id: string) => number | undefined;
  // 0-based position on the My players priority list; undefined = not listed.
  priorityIndex: (id: string) => number | undefined;
  posOf: (id: string) => string | null;
  // Why he can't play this week (out / IR / bye), or null if he's available.
  unavailableReason: (id: string) => string | null;
}

export interface BenchedWatched {
  key: string;
  leagueId: string;
  leagueName: string;
  playerId: string;
  rank: number | null; // 1-based overall rank, null if only on the priority list
  priority: boolean;
  // "problem": healthy, and a worse player / empty slot holds his spot.
  // "behind_better": healthy, but every eligible spot is held by someone ranked as well or better.
  // "unavailable": benched because he's injured / on bye (expected).
  kind: "problem" | "behind_better" | "unavailable";
  reason: string | null; // for "unavailable"
  displaces: string | null; // player id he'd replace (for "problem"); null = empty slot
}

const EMPTY = "0";
const isEmpty = (id: string | undefined) => !id || id === EMPTY;

export function findBenchedWatched(leagues: WatchLeague[], opts: WatchOptions): BenchedWatched[] {
  // Lower = more wanted. Priority list beats rankings; unranked is worst.
  const value = (id: string): number => {
    const pi = opts.priorityIndex(id);
    if (pi !== undefined) return -1000 + pi;
    const ro = opts.rankOrder(id);
    return ro === undefined ? Infinity : ro;
  };
  const watched = (id: string) => {
    const ro = opts.rankOrder(id);
    return opts.priorityIndex(id) !== undefined || (ro !== undefined && ro < opts.topN);
  };

  const out: BenchedWatched[] = [];
  for (const lg of leagues) {
    const startersSet = new Set(lg.starters.filter((id) => !isEmpty(id)));
    const reserveSet = new Set(lg.reserve);
    for (const id of lg.players) {
      if (!watched(id) || startersSet.has(id) || reserveSet.has(id)) continue; // starting, or on IR

      const ro = opts.rankOrder(id);
      const base = {
        key: `${lg.leagueId}:${id}`,
        leagueId: lg.leagueId,
        leagueName: lg.leagueName,
        playerId: id,
        rank: ro !== undefined ? ro + 1 : null,
        priority: opts.priorityIndex(id) !== undefined,
      };

      const why = opts.unavailableReason(id);
      if (why) {
        out.push({ ...base, kind: "unavailable", reason: why, displaces: null });
        continue;
      }

      // Find the worst-held eligible spot (empty counts as worst of all).
      const pos = opts.posOf(id);
      const mine = value(id);
      let worst: { slot: number; v: number } | null = null;
      lg.slotCodes.forEach((code, i) => {
        if (!pos || !eligiblePositions(code).includes(pos)) return;
        const occupant = lg.starters[i];
        const v = isEmpty(occupant) ? Infinity : opts.unavailableReason(occupant) ? Infinity : value(occupant);
        if (!worst || v > worst.v) worst = { slot: i, v };
      });

      const w = worst as { slot: number; v: number } | null;
      if (w && w.v > mine) {
        const occupant = lg.starters[w.slot];
        out.push({ ...base, kind: "problem", reason: null, displaces: isEmpty(occupant) ? null : occupant });
      } else {
        out.push({ ...base, kind: "behind_better", reason: null, displaces: null });
      }
    }
  }
  return out;
}
