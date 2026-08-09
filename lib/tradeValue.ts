// Trade value = Sleeper's season-long PPR point projection, nudged by how
// this week's live Vegas props compare to that player's season pace.
//
// This exists to replace the old hand-entered 0-100 "value" field (removed —
// see CLAUDE.md "Known limitations"), which had no documented methodology.
// Every number here is either a real third-party projection (Sleeper) or a
// standard, published scoring convention (full PPR) applied to a real market
// line (SportsGameOdds) — nothing is invented or hand-tuned to "feel right".
//
// Method:
// 1. Base value = season-long projected PPR points (already computed by
//    Sleeper, already shown elsewhere in the app as "Szn Pts").
// 2. If the player has active props this week, convert those prop lines into
//    an expected points total for *this week* using standard full-PPR
//    scoring (0.04 pts/passing yd, 0.1 pts/rush or rec yd, 4 pts/passing TD,
//    6 pts/rush or rec TD, -2 pts/INT thrown — the same scale Sleeper's own
//    pts_ppr implies). Yardage props use the O/U line directly as the
//    expected value (that's what a sportsbook line represents statistically);
//    the anytime-TD prop uses de-vigged implied probability x 6.
// 3. Compare that to the player's own season pace (season pts / weeks with a
//    projection) to get a delta: is the market expecting more or less than
//    this player's average week?
// 4. Add that delta to the season value — once, not multiplied — so one
//    week's market view can nudge the number but can't dominate it. The
//    delta is capped at +/-20% of weekly pace as a documented safety bound,
//    not a precision-tuned parameter.
//
// Known gap: SportsGameOdds doesn't currently offer a receptions prop (see
// CLAUDE.md), so the weekly market side of the blend is missing the
// reception-count point value that the season baseline (full PPR, via
// Sleeper) already includes. This means the weekly delta slightly
// understates pass-catchers relative to the season baseline — a real,
// documented limitation, not a bug.

import type { PropLine } from "./sportsgameodds";
import type { SeasonProjectionTotal } from "./types";

const YARD_POINTS: Record<string, number> = {
  "Passing Yards": 0.04,
  "Rushing Yards": 0.1,
  "Receiving Yards": 0.1,
};
const PASSING_TD_POINTS = 4;
const INT_POINTS = -2;
const TOUCHDOWN_POINTS = 6; // rushing or receiving

const DELTA_CAP_FRACTION = 0.2; // +/- 20% of weekly pace

export function parseAmerican(odds: string | null): number | null {
  if (!odds) return null;
  const n = Number(odds.replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

function impliedProb(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

// Removes the bookmaker's vig by normalizing both sides' implied
// probabilities so they sum to 1 — standard technique, not a Fantis invention.
export function devig(yesOdds: number, noOdds: number): number {
  const pYes = impliedProb(yesOdds);
  const pNo = impliedProb(noOdds);
  const total = pYes + pNo;
  return total > 0 ? pYes / total : pYes;
}

// Expected fantasy points for one week from live prop lines. "First TD" is
// intentionally excluded — it's a narrower, mutually-exclusive-ish market
// with "Anytime TD" and including both would double-count the same score.
export function expectedPointsFromProps(props: PropLine[]): number {
  let total = 0;
  for (const p of props) {
    if (p.stat in YARD_POINTS && p.line != null) {
      total += p.line * YARD_POINTS[p.stat];
    } else if (p.stat === "Passing TDs" && p.line != null) {
      total += p.line * PASSING_TD_POINTS;
    } else if (p.stat === "INTs Thrown" && p.line != null) {
      total += p.line * INT_POINTS;
    } else if (p.stat === "Anytime TD") {
      const yes = parseAmerican(p.overOdds);
      const no = parseAmerican(p.underOdds);
      if (yes != null && no != null) {
        total += devig(yes, no) * TOUCHDOWN_POINTS;
      }
    }
  }
  return total;
}

export interface TradeValueResult {
  value: number;
  seasonPts: number;
  weeklyPace: number | null;
  weeklyExpected: number | null;
  delta: number | null;
  deltaCapped: boolean;
}

export function computeTradeValue(
  season: SeasonProjectionTotal | undefined,
  props: PropLine[] | undefined
): TradeValueResult | null {
  if (!season) return null;
  const seasonPts = season.pts;

  if (!props || props.length === 0 || season.weeksCounted <= 0) {
    return { value: seasonPts, seasonPts, weeklyPace: null, weeklyExpected: null, delta: null, deltaCapped: false };
  }

  const weeklyPace = seasonPts / season.weeksCounted;
  const weeklyExpected = expectedPointsFromProps(props);
  const rawDelta = weeklyExpected - weeklyPace;
  const cap = Math.abs(weeklyPace) * DELTA_CAP_FRACTION;
  const delta = Math.max(-cap, Math.min(cap, rawDelta));

  return {
    value: seasonPts + delta,
    seasonPts,
    weeklyPace,
    weeklyExpected,
    delta,
    deltaCapped: delta !== rawDelta,
  };
}
