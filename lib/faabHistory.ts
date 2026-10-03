// Pure aggregation: real past winning FAAB bids -> a suggested bid per
// league per position. Input is already-synced LeagueTransaction rows
// (lib/managerSync.ts writes them; nothing here fetches or touches Sleeper).
// Used so a waiver claim defaults to something closer to what actually wins
// in THAT league, instead of always defaulting to the league's bid minimum.

export interface FaabTxnRow {
  leagueId: string;
  waiverBid: number | null;
  adds: unknown; // raw Json column: [{playerId, playerName, pos, rosterId, teamName}] | null
}

export interface FaabStat {
  median: number;
  p75: number; // a slightly more aggressive number for a "don't lose this one" bid
  n: number; // sample size — shown so a 1-claim "median" isn't mistaken for a trend
}

// FaabStats[leagueId][position] — position is Sleeper's own code (QB/RB/WR/TE/K/DEF).
export type FaabStats = Record<string, Record<string, FaabStat>>;

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// A completed waiver claim's `adds` is normally a single player; if a row
// somehow carries more than one, the whole bid is credited to each of their
// positions (rare, and safer than guessing which one the bid was "really"
// for) — real data, just not further disambiguated.
function positionsOf(adds: unknown): string[] {
  if (!Array.isArray(adds)) return [];
  const out: string[] = [];
  for (const a of adds) {
    const pos = a && typeof a === "object" ? (a as Record<string, unknown>).pos : null;
    if (typeof pos === "string" && pos) out.push(pos);
  }
  return out;
}

export function computeFaabStats(rows: FaabTxnRow[]): FaabStats {
  const buckets = new Map<string, Map<string, number[]>>(); // leagueId -> pos -> bids
  for (const r of rows) {
    if (typeof r.waiverBid !== "number" || r.waiverBid < 0) continue;
    const positions = positionsOf(r.adds);
    if (positions.length === 0) continue;
    let byPos = buckets.get(r.leagueId);
    if (!byPos) buckets.set(r.leagueId, (byPos = new Map()));
    for (const pos of positions) {
      const arr = byPos.get(pos);
      if (arr) arr.push(r.waiverBid);
      else byPos.set(pos, [r.waiverBid]);
    }
  }
  const out: FaabStats = {};
  for (const [leagueId, byPos] of buckets) {
    const posOut: Record<string, FaabStat> = {};
    for (const [pos, bids] of byPos) {
      const sorted = [...bids].sort((a, b) => a - b);
      posOut[pos] = { median: median(sorted), p75: percentile(sorted, 75), n: sorted.length };
    }
    out[leagueId] = posOut;
  }
  return out;
}

// The number actually offered when a suggestion exists: p75 (a competitive but
// not wild bid) for 3+ real data points, the median for 1-2 (too little to
// trust the tail), never below the league's own bid minimum. Falls back to
// the caller-supplied default (usually bid-min) when there's no history at all.
export function suggestBid(stats: FaabStats | null | undefined, leagueId: string, pos: string, bidMin: number, fallback: number): { bid: number; n: number; sourced: boolean } {
  const s = stats?.[leagueId]?.[pos];
  if (!s || s.n === 0) return { bid: fallback, n: 0, sourced: false };
  const raw = s.n >= 3 ? s.p75 : s.median;
  return { bid: Math.max(bidMin, Math.round(raw)), n: s.n, sourced: true };
}
