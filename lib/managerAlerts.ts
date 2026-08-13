// Pure alert-computation rules for Sleeper Manager — no Prisma, no fetch
// calls, so the rules themselves are reviewable independent of
// lib/managerSync.ts's fetch/upsert orchestration. Every check reuses an
// existing, real data source already in this codebase rather than
// inventing a new classification:
//   - buildStartingSlots/eligiblePositions (lib/rosterSlots.ts), zipped
//     against starters[i] !== "0" exactly as components/TeamHub.tsx does.
//   - /out|doubtful|ir/i.test(entry.inj), the exact regex already used in
//     components/Portfolio.tsx for "is this player effectively unavailable".
//   - BYE_WEEKS_2026 (lib/byeWeeks.ts), real hand-checked bye data.
import { buildStartingSlots } from "./rosterSlots";
import { BYE_WEEKS_2026 } from "./byeWeeks";
import type { PlayerMap } from "./types";

const TRADE_DEADLINE_WARNING_WEEKS = 2;

export type AlertSeverity = "action_required" | "review";

export interface ComputedAlert {
  type:
    | "injured_starter"
    | "empty_slot"
    | "bye_starter"
    | "draft_upcoming"
    | "trade_deadline_upcoming"
    | "unclaimed_team";
  severity: AlertSeverity;
  message: string;
  playerId: string | null;
}

export interface ComputeAlertsInput {
  leagueStatus: string; // League.status
  currentWeek: number;
  rosterPositions: string[]; // from the league's settings.roster_positions
  starters: string[]; // Roster.starters
  pmap: PlayerMap | null; // null if the player dump fetch failed this sync
  rosterOwnerIds: (string | null)[]; // every roster's owner_id in this league
  draftStatus: string | null; // null = no draft found
  tradeDeadlineWeek: number | null; // from settings.trade_deadline
}

export function computeAlerts(input: ComputeAlertsInput): ComputedAlert[] {
  const alerts: ComputedAlert[] = [];
  if (input.leagueStatus === "in_season") {
    alerts.push(...checkEmptySlots(input));
    alerts.push(...checkInjuredStarters(input));
    alerts.push(...checkByeStarters(input));
    alerts.push(...checkTradeDeadline(input));
  }
  alerts.push(...checkDraftUpcoming(input));
  alerts.push(...checkUnclaimedTeam(input));
  return alerts;
}

function checkEmptySlots({ rosterPositions, starters }: ComputeAlertsInput): ComputedAlert[] {
  const slots = buildStartingSlots(rosterPositions);
  const out: ComputedAlert[] = [];
  slots.forEach((slot, i) => {
    const playerId = starters[i];
    if (!playerId || playerId === "0") {
      out.push({
        type: "empty_slot",
        severity: "action_required",
        message: `Empty ${slot.label} slot`,
        playerId: null,
      });
    }
  });
  return out;
}

function checkInjuredStarters({ starters, pmap }: ComputeAlertsInput): ComputedAlert[] {
  if (!pmap) return [];
  const out: ComputedAlert[] = [];
  for (const playerId of starters) {
    if (!playerId || playerId === "0") continue;
    const entry = pmap[playerId];
    if (!entry?.inj || !/out|doubtful|ir/i.test(entry.inj)) continue;
    out.push({
      type: "injured_starter",
      severity: "action_required",
      message: `${entry.n} (${entry.p}) is starting while listed ${entry.inj}`,
      playerId,
    });
  }
  return out;
}

function checkByeStarters({ starters, pmap, currentWeek }: ComputeAlertsInput): ComputedAlert[] {
  if (!pmap) return [];
  const out: ComputedAlert[] = [];
  for (const playerId of starters) {
    if (!playerId || playerId === "0") continue;
    const entry = pmap[playerId];
    if (!entry || BYE_WEEKS_2026[entry.t] !== currentWeek) continue;
    out.push({
      type: "bye_starter",
      severity: "action_required",
      message: `${entry.n} (${entry.p}, ${entry.t}) is on bye this week but starting`,
      playerId,
    });
  }
  return out;
}

function checkDraftUpcoming({ draftStatus }: ComputeAlertsInput): ComputedAlert[] {
  if (!draftStatus || draftStatus === "complete") return [];
  return [
    {
      type: "draft_upcoming",
      severity: "review",
      message: draftStatus === "drafting" ? "Draft is in progress" : "Draft hasn't happened yet",
      playerId: null,
    },
  ];
}

function checkTradeDeadline({ tradeDeadlineWeek, currentWeek }: ComputeAlertsInput): ComputedAlert[] {
  if (tradeDeadlineWeek == null) return [];
  const diff = tradeDeadlineWeek - currentWeek;
  if (diff < 0 || diff > TRADE_DEADLINE_WARNING_WEEKS) return [];
  return [
    {
      type: "trade_deadline_upcoming",
      severity: "review",
      message:
        diff === 0
          ? `Trade deadline is this week (week ${tradeDeadlineWeek})`
          : `Trade deadline in ${diff} week${diff === 1 ? "" : "s"} (week ${tradeDeadlineWeek})`,
      playerId: null,
    },
  ];
}

function checkUnclaimedTeam({ leagueStatus, rosterOwnerIds }: ComputeAlertsInput): ComputedAlert[] {
  if (leagueStatus === "complete") return [];
  const unclaimed = rosterOwnerIds.filter((id) => !id).length;
  if (unclaimed === 0) return [];
  return [
    {
      type: "unclaimed_team",
      severity: "review",
      message: `${unclaimed} unclaimed team${unclaimed === 1 ? "" : "s"} in this league`,
      playerId: null,
    },
  ];
}
