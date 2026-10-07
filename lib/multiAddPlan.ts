// Pure planning for the multi-target add board (several players at once,
// across many leagues) — an extension of lib/bulkPlan.ts's single-target
// buildAddPlan. No fetching, no React, no Sleeper calls. Everything here is a
// *suggestion* the user reviews before anything is sent.
//
// The one thing a single-target plan doesn't need to worry about: two targets
// landing in the SAME league. If both need a drop, they must not be proposed
// to drop the SAME bench player — each drop candidate is claimed by at most
// one target, in the order the targets were given.
import type { DropRank, PlanLeague } from "./bulkPlan";

function setting(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}
function num(settings: unknown, key: string): number {
  const inner = setting(settings, "settings");
  const v = inner && typeof inner === "object" ? (inner as Record<string, unknown>)[key] : undefined;
  return typeof v === "number" ? v : 0;
}

export interface MultiAddRow {
  key: string; // `${leagueId}:${targetId}`
  targetId: string;
  leagueId: string;
  leagueName: string;
  rosterId: number;
  full: boolean;
  dropId: string | null;
  dropCandidates: string[]; // still available in this league (not claimed by an earlier target's row)
  faab: boolean;
  budgetLeft: number | null;
  bidMin: number;
  bid: number; // a suggested starting point — the caller may override per row
}

export interface LeagueBudgetWarning {
  leagueId: string;
  leagueName: string;
  targetCount: number;
  totalBid: number;
  budgetLeft: number;
}

export function buildMultiAddPlan(
  targetIds: string[],
  leagues: PlanLeague[],
  rosteredLeagueIdsByTarget: Record<string, ReadonlySet<string>>,
  rank: DropRank,
  suggestBidFor: (leagueId: string, targetId: string, bidMin: number) => number,
  isPriority: (playerId: string) => boolean = () => false
): { rows: MultiAddRow[]; budgetWarnings: LeagueBudgetWarning[] } {
  const asc = (a: string, b: string) => {
    const [a1, a2] = rank(a);
    const [b1, b2] = rank(b);
    return a1 - b1 || a2 - b2;
  };
  const rows: MultiAddRow[] = [];
  const budgetWarnings: LeagueBudgetWarning[] = [];

  for (const lg of leagues) {
    const rosterSize = (() => {
      const rp = setting(lg.settings, "roster_positions");
      return Array.isArray(rp) ? rp.length : 0;
    })();
    const active = lg.players.length - lg.reserve.length;
    let openSlots = Math.max(0, rosterSize - active);

    // Bench players droppable for THIS league, weakest first — same rule as
    // the single-target planner: never a starter, never on IR, never a
    // Priority-listed player.
    const benchPool = lg.players
      .filter((id) => !lg.starters.includes(id) && !lg.reserve.includes(id) && !isPriority(id))
      .sort(asc);
    const usedDrops = new Set<string>();

    const faab = num(lg.settings, "waiver_type") === 2;
    const budget = num(lg.settings, "waiver_budget");
    const bidMin = num(lg.settings, "waiver_bid_min");
    const budgetLeft = faab && budget > 0 ? Math.max(0, budget - (lg.faabUsed ?? 0)) : null;

    let leagueBidTotal = 0;
    let leagueTargetCount = 0;

    for (const targetId of targetIds) {
      if (rosteredLeagueIdsByTarget[targetId]?.has(lg.leagueId)) continue; // someone already has him
      if (lg.players.includes(targetId)) continue; // defensive — shouldn't happen given the check above

      let full: boolean;
      let dropId: string | null = null;
      if (openSlots > 0) {
        full = false;
        openSlots--;
      } else {
        full = true;
        const candidates = benchPool.filter((id) => id !== targetId && !usedDrops.has(id));
        dropId = candidates[0] ?? null;
        if (dropId) usedDrops.add(dropId);
      }
      const dropCandidates = benchPool.filter((id) => id !== targetId && (!usedDrops.has(id) || id === dropId));
      const bid = suggestBidFor(lg.leagueId, targetId, bidMin);
      rows.push({
        key: `${lg.leagueId}:${targetId}`,
        targetId,
        leagueId: lg.leagueId,
        leagueName: lg.leagueName,
        rosterId: lg.rosterId,
        full,
        dropId,
        dropCandidates,
        faab,
        budgetLeft,
        bidMin,
        bid: Math.max(bidMin, bid),
      });
      if (faab) {
        leagueBidTotal += Math.max(bidMin, bid);
        leagueTargetCount++;
      }
    }
    if (faab && budgetLeft != null && leagueTargetCount > 0 && leagueBidTotal > budgetLeft) {
      budgetWarnings.push({ leagueId: lg.leagueId, leagueName: lg.leagueName, targetCount: leagueTargetCount, totalBid: leagueBidTotal, budgetLeft });
    }
  }
  return { rows, budgetWarnings };
}
