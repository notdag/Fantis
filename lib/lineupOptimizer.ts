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

// Real players must always beat an empty slot, and an unchanged lineup must
// beat an equal-points reshuffle — tiny fixed nudges, far below any real
// projection difference (projections are in whole tenths).
const REAL_PLAYER_BONUS = 0.001;
const STAY_PUT_BONUS = 0.0005;

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
    const BIG = 1e6;
    const cost = freeSlots.map((slotIdx) => {
      const eligible = new Set(eligiblePositions(slotCodes[slotIdx]));
      const row = new Array(cols).fill(0);
      for (let c = 0; c < pool.length; c++) {
        const id = pool[c];
        const pos = posOf(id)!;
        if (!eligible.has(pos)) {
          row[c] = BIG * 10; // not allowed in this slot
        } else {
          const weight = points(id) + REAL_PLAYER_BONUS + (current[slotIdx] === id ? STAY_PUT_BONUS : 0);
          row[c] = BIG - weight;
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

  // Never propose a lineup that's worse than the one already set.
  if (optimalPoints < currentPoints) {
    return { starters: current, currentPoints, optimalPoints: currentPoints, gain: 0, changes: [] };
  }
  return { starters: result, currentPoints, optimalPoints, gain: optimalPoints - currentPoints, changes };
}
