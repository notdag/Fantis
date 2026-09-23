// Pure lineup optimizer for the bulk "Optimize" tab. Given one roster, one
// league's real starting slots, and per-player projected points, it finds the
// best legal assignment of players to slots. No fetching, no React, no
// Sleeper calls — inputs in, a proposed lineup out. The caller (UI) decides
// what "points", "unavailable" and "locked" mean; nothing here invents data.
//
// Exact, not greedy: overlapping flex types (WR/RB flex, WR/TE flex, FLEX,
// SUPER_FLEX) make a greedy fill misallocate, so this solves the assignment
// problem properly (Hungarian algorithm; roughly 12 slots x 25 players).
import { eligiblePositions } from "./rosterSlots";

export interface OptimizeInput {
  slotCodes: string[]; // starting slots in the league's own order (BN excluded)
  starters: string[]; // current lineup, positional; "0"/"" = empty
  candidates: string[]; // every active-roster player (not IR/taxi)
  posOf: (id: string) => string | null;
  points: (id: string) => number; // projected points, real data only (missing = 0)
  unavailable: (id: string) => boolean; // out / IR / bye — scores nothing this week
  locked: (id: string) => boolean; // game already started — can't be moved
  // The owner's own list. priorityRank: 0 = top pick; undefined = not listed.
  // Optional — without it this is a pure best-projection optimizer.
  priorityRank?: (id: string) => number | undefined;
  avoid?: (id: string) => boolean;
  // Position in the owner's overall curated rankings (0 = best); undefined =
  // not ranked. This is a full preference BAND — a ranked player always beats
  // an unranked one regardless of points — meant for an explicit "go by my
  // rankings" mode (BulkOptimize's rankings toggle), not the default
  // projection-driven optimizer. Optional — omit it to choose purely by
  // projection (plus priority/avoid).
  rankOrder?: (id: string) => number | undefined;
  // Same curated rankings, but as a genuine tie-break only — worth far less
  // than any real point difference, so it only decides a start/sit call the
  // projections themselves can't separate. This is what "Fix my lineups"
  // uses by default: still projection-first, rankings only settle a coin
  // flip. Optional — omit it to leave true ties to solve order.
  rankTiebreak?: (id: string) => number | undefined;
  // Real kickoff day for a player's team this week, from actual schedule
  // data — not a guess. "THU"/"MON" nudge slot choice (see the bonuses
  // below); any other day (including undefined, e.g. bye or unknown) gets no
  // nudge. Optional — omit it to leave slot choice entirely to points/rank.
  gameDay?: (id: string) => "THU" | "MON" | undefined;
}

export interface LineupChange {
  slotIndex: number;
  slotCode: string;
  out: string | null;
  in: string | null;
}

export interface OptimizeResult {
  starters: string[];
  currentPoints: number;
  optimalPoints: number;
  gain: number;
  changes: LineupChange[];
}

const EMPTY = "0";
const isEmpty = (id: string | undefined) => !id || id === EMPTY;

// Slot-assignment weights, as bands so each rule strictly outranks the next:
//   priority list  >  owner's rankings (/admin order)  >  unranked players (by
//   projection)  >  avoid band  >  empty slot
// - Every real player beats an empty slot (REAL), even an "avoid" one — a
//   slot is only left empty when nobody eligible exists.
// - The owner's priority list adds a band big enough to dominate any
//   projection gap; rank order breaks ties between priority players.
// - "Avoid" players take a penalty smaller than REAL, so they only start when
//   no normal player can fill the slot.
// - STAY_PUT keeps an unchanged lineup ahead of an equal-weight reshuffle.
// Injured, bye and locked players never reach this step (they're excluded or
// frozen before it), so a preference can never force one into a lineup.
const REAL_PLAYER_BONUS = 1e6;
const PRIORITY_BASE = 1e7;
const PRIORITY_RANK_STEP = 1000; // per list position; list is capped at 500
// The owner's curated rankings sit between the two: above any projection gap,
// below the explicit priority list. Better (lower) rank wins a contested
// slot; players missing from the rankings fall back to projections.
const RANKING_BASE = 3e6;
const RANKING_STEP = 1000; // per rank position; ranks are capped at 1000
const AVOID_PENALTY = 5e5;
const STAY_PUT_BONUS = 0.0005;
// The default optimizer's rank tie-break (see rankTiebreak above). The step
// must exceed STAY_PUT_BONUS or two ADJACENT curated ranks (e.g. #14 vs #15)
// would never resolve — inertia would win every time. Capped to a shallow
// window (only the top RANK_TIEBREAK_CAP spots get a meaningful nudge) so
// the total possible swing stays well below any real point difference — a
// curated rank never overrides the week's actual projections, only settles
// a tie they leave unresolved.
const RANK_TIEBREAK_STEP = 0.0006;
const RANK_TIEBREAK_CAP = 50;
// A priority-ranked player's own true position slot (WR, not FLEX) is worth
// the exact same real points as a flex slot, so nothing above would ever
// break a tie between them — the assignment could land him in FLEX while an
// equally-weighted teammate sits in his true slot, purely as an artifact of
// solve order. This nudges a priority player toward his own true slot when
// eligible for both, so "start him" doesn't accidentally mean "in flex."
const PRIORITY_TRUE_SLOT_BONUS = 0.001;
// Same idea, for real kickoff timing: a Thursday player's decision locks
// first, so there's no benefit to leaving him "floating" in flex — put him
// in his true slot. A Monday player locks last, so keeping him in flex (the
// slot you'd naturally swap) leaves the week's latest, most-informed
// decision in the most flexible spot. Bigger than STAY_PUT_BONUS so it
// actually moves an already-correct-looking lineup when the swap is a real
// day-of-week fix, but still far smaller than any real point difference.
const THU_TRUE_SLOT_BONUS = 0.002;
const MON_FLEX_SLOT_BONUS = 0.002;
const BIG = 1e9;

// Hungarian algorithm (min cost), rows <= cols. Returns, for each row, the
// column assigned to it.
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  const INF = 1e15;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] !== 0) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

export function optimizeLineup(input: OptimizeInput): OptimizeResult {
  const { slotCodes, candidates, posOf, points, unavailable, locked } = input;
  const current = slotCodes.map((_, i) => (isEmpty(input.starters[i]) ? EMPTY : input.starters[i]));

  const effective = (id: string) => (isEmpty(id) || unavailable(id) ? 0 : points(id));
  const currentPoints = current.reduce((sum, id) => sum + effective(id), 0);

  // What a player is worth to the assignment: real points plus the owner's
  // preference band. (Empty slots and unavailable players are worth 0.)
  const weight = (id: string) => {
    if (isEmpty(id) || unavailable(id)) return 0;
    let w = REAL_PLAYER_BONUS + points(id);
    const rank = input.priorityRank?.(id);
    if (rank !== undefined) w += PRIORITY_BASE + (500 - Math.min(rank, 500)) * PRIORITY_RANK_STEP;
    else if (input.avoid?.(id)) w -= AVOID_PENALTY;
    else {
      const order = input.rankOrder?.(id);
      if (order !== undefined) w += RANKING_BASE + (1000 - Math.min(order, 1000)) * RANKING_STEP;
    }
    const tb = input.rankTiebreak?.(id);
    if (tb !== undefined) w += (RANK_TIEBREAK_CAP - Math.min(tb, RANK_TIEBREAK_CAP)) * RANK_TIEBREAK_STEP;
    return w;
  };

  // A player whose game has started stays exactly where he is: his slot is
  // frozen and he can't be pulled from the bench into another slot.
  const fixed = new Set<number>();
  const frozen = new Set<string>();
  current.forEach((id, i) => {
    if (!isEmpty(id) && locked(id)) {
      fixed.add(i);
      frozen.add(id);
    }
  });

  const freeSlots = slotCodes.map((_, i) => i).filter((i) => !fixed.has(i));
  const pool = candidates.filter((id) => !frozen.has(id) && !locked(id) && !unavailable(id) && posOf(id));

  const result = [...current];
  if (freeSlots.length > 0) {
    // Columns: every pool player, then one "empty" filler per free slot so a
    // perfect assignment always exists even on a thin roster.
    const cols = pool.length + freeSlots.length;
    const cost = freeSlots.map((slotIdx) => {
      const eligible = new Set(eligiblePositions(slotCodes[slotIdx]));
      const isFlexSlot = eligible.size > 1; // true, single-position slots resolve to exactly one eligible position
      const row = new Array(cols).fill(0);
      for (let c = 0; c < pool.length; c++) {
        const id = pool[c];
        const pos = posOf(id)!;
        if (!eligible.has(pos)) {
          row[c] = BIG * 10; // not allowed in this slot
        } else {
          const trueSlot = input.priorityRank?.(id) !== undefined && pos === slotCodes[slotIdx] ? PRIORITY_TRUE_SLOT_BONUS : 0;
          const day = input.gameDay?.(id);
          const dayBonus = day === "THU" && !isFlexSlot ? THU_TRUE_SLOT_BONUS : day === "MON" && isFlexSlot ? MON_FLEX_SLOT_BONUS : 0;
          row[c] = BIG - (weight(id) + trueSlot + dayBonus + (current[slotIdx] === id ? STAY_PUT_BONUS : 0));
        }
      }
      for (let c = pool.length; c < cols; c++) row[c] = BIG; // empty filler, weight 0
      return row;
    });
    const assignment = hungarian(cost);
    freeSlots.forEach((slotIdx, r) => {
      const col = assignment[r];
      result[slotIdx] = col >= 0 && col < pool.length && cost[r][col] < BIG * 5 ? pool[col] : EMPTY;
    });
    // Nobody to put in a slot: leave whoever is already there (e.g. an
    // injured starter with no healthy replacement) rather than proposing to
    // empty it — unless that player got moved to another slot.
    const placed = new Set(result.filter((id) => !isEmpty(id)));
    freeSlots.forEach((slotIdx) => {
      if (result[slotIdx] === EMPTY && !isEmpty(current[slotIdx]) && !placed.has(current[slotIdx])) {
        result[slotIdx] = current[slotIdx];
        placed.add(current[slotIdx]);
      }
    });
  }

  const optimalPoints = result.reduce((sum, id) => sum + effective(id), 0);
  const changes: LineupChange[] = [];
  result.forEach((id, i) => {
    if (id !== current[i]) {
      changes.push({
        slotIndex: i,
        slotCode: slotCodes[i],
        out: isEmpty(current[i]) ? null : current[i],
        in: isEmpty(id) ? null : id,
      });
    }
  });

  // Never propose a lineup that's worse than the one already set, judged the
  // same way the assignment is (points + the owner's preferences). Note
  // `gain` is real projected points and can be negative when a preference
  // deliberately starts someone with a lower projection.
  const score = (ids: string[]) => ids.reduce((sum, id) => sum + weight(id), 0);
  if (score(result) < score(current) - 1e-6) {
    return { starters: current, currentPoints, optimalPoints: currentPoints, gain: 0, changes: [] };
  }
  return { starters: result, currentPoints, optimalPoints, gain: optimalPoints - currentPoints, changes };
}
