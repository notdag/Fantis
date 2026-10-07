// Live league snapshot + per-player availability classification. Pure given
// injected fetchers; READ endpoints only (Sleeper's public GET routes).
import type { CcLeague, LeagueSnapshot, LeagueResult, SnapRoster, PlayerCard, AvailState } from "./types";

export interface RawRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi?: string[] | null;
  settings?: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number } | null;
}

export interface RawTxn {
  type: string;
  status: string;
  created: number;
  drops: Record<string, number> | null;
}

export interface SnapshotDeps {
  getRosters: (leagueId: string) => Promise<RawRoster[]>;
  getTransactions: (leagueId: string, leg: number) => Promise<RawTxn[]>;
}

function inner(settings: unknown): Record<string, unknown> {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>).settings : null;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : {};
}
const numSetting = (settings: unknown, key: string): number | null => {
  const v = inner(settings)[key];
  return typeof v === "number" ? v : null;
};
export const rosterPositions = (settings: unknown): string[] | null => {
  const rp = settings && typeof settings === "object" ? (settings as Record<string, unknown>).roster_positions : null;
  return Array.isArray(rp) ? (rp as string[]) : null;
};

const DAY = 86_400_000;

export async function fetchSnapshot(
  league: CcLeague,
  deps: SnapshotDeps,
  now: number,
  currentLeg: number,
  withTransactions = true
): Promise<LeagueSnapshot> {
  let rosters: SnapRoster[];
  try {
    const raw = await deps.getRosters(league.id);
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("no rosters returned");
    rosters = raw.map((r) => ({
      rosterId: r.roster_id,
      ownerId: r.owner_id ?? null,
      players: r.players ?? [],
      starters: r.starters ?? [],
      reserve: r.reserve ?? [],
      taxi: r.taxi ?? [],
      wins: r.settings?.wins,
      losses: r.settings?.losses,
      ties: r.settings?.ties,
      fpts: typeof r.settings?.fpts === "number" ? r.settings.fpts + (r.settings.fpts_decimal ?? 0) / 100 : undefined,
    }));
  } catch (e) {
    return { league, status: "FAILED", fetchedAt: now, rosters: null, recentDrops: null, error: msg(e) };
  }
  // My roster must be identifiable and belong to me — otherwise every "on my
  // roster" / "drop" answer for this league would be a guess.
  const mine = rosters.find((r) => r.rosterId === league.rosterId);
  if (!mine || (mine.ownerId && league.ownerId && mine.ownerId !== league.ownerId)) {
    return {
      league,
      status: "FAILED",
      fetchedAt: now,
      rosters,
      recentDrops: null,
      error: "couldn't confirm which roster is mine in this league",
    };
  }
  if (!withTransactions) return { league, status: "SUCCESS", fetchedAt: now, rosters, recentDrops: null };

  const recent: Record<string, number> = {};
  const errors: string[] = [];
  const legs = [...new Set([currentLeg, currentLeg - 1].filter((l) => l >= 1))];
  for (const leg of legs) {
    try {
      const txns = await deps.getTransactions(league.id, leg);
      for (const t of txns ?? []) {
        if (t.status !== "complete" || !t.drops) continue;
        for (const pid of Object.keys(t.drops)) {
          if (!(pid in recent) || t.created > recent[pid]) recent[pid] = t.created;
        }
      }
    } catch (e) {
      errors.push(`transactions leg ${leg}: ${msg(e)}`);
    }
  }
  if (errors.length > 0) {
    return { league, status: "PARTIAL", fetchedAt: now, rosters, recentDrops: null, error: errors.join("; ") };
  }
  return { league, status: "SUCCESS", fetchedAt: now, rosters, recentDrops: recent };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Slot names that can hold each position (Sleeper's own roster_positions vocabulary).
const SLOTS_FOR: Record<string, string[]> = {
  QB: ["QB", "SUPER_FLEX"],
  RB: ["RB", "FLEX", "SUPER_FLEX", "WRRB_FLEX"],
  WR: ["WR", "FLEX", "SUPER_FLEX", "WRRB_FLEX", "REC_FLEX"],
  TE: ["TE", "FLEX", "SUPER_FLEX", "REC_FLEX"],
  K: ["K"],
  DEF: ["DEF", "DST"],
};

export function positionEligible(settings: unknown, pos: string): boolean | null {
  const rp = rosterPositions(settings);
  if (!rp || !pos) return null;
  const slots = SLOTS_FOR[pos];
  if (!slots) return null;
  return rp.some((s) => slots.includes(s));
}

export function activeCount(snap: LeagueSnapshot): number | null {
  const mine = snap.rosters?.find((r) => r.rosterId === snap.league.rosterId);
  if (!mine) return null;
  // Roster spots are used by everything except IR and taxi.
  const off = new Set([...mine.reserve, ...mine.taxi]);
  return mine.players.filter((id) => !off.has(id)).length;
}

export function classifyPlayer(snap: LeagueSnapshot, player: PlayerCard, now: number): LeagueResult {
  const lg = snap.league;
  const base = {
    leagueId: lg.id,
    leagueName: lg.name,
    playerId: player.id,
    scanStatus: snap.status,
    needsDrop: null as boolean | null,
    activeCount: null as number | null,
    rosterLimit: null as number | null,
    faab: numSetting(lg.settings, "waiver_type") === 2,
    budgetLeft: null as number | null,
  };
  if (snap.status === "FAILED" || !snap.rosters) {
    return { ...base, state: "SCAN_FAILED", detail: snap.error ? `Could not scan: ${snap.error}.` : "Could not scan this league." };
  }
  const mine = snap.rosters.find((r) => r.rosterId === lg.rosterId)!;
  if (mine.players.includes(player.id)) {
    return { ...base, state: "ON_MY_ROSTER", detail: `${player.name} is already on your roster.` };
  }
  const holder = snap.rosters.find((r) => r.players.includes(player.id));
  if (holder) {
    return {
      ...base,
      state: "ON_OTHER_ROSTER",
      owner: `roster ${holder.rosterId}`,
      detail: `Rostered by another team (roster ${holder.rosterId}).`,
    };
  }
  const eligible = positionEligible(lg.settings, player.pos);
  if (eligible === false) {
    return { ...base, state: "NOT_ELIGIBLE", detail: `This league has no roster slot a ${player.pos} can fill.` };
  }
  if (eligible === null) {
    return { ...base, state: "UNKNOWN", detail: "Couldn't read this league's roster slots to check position eligibility." };
  }

  // Roster requirement (only matters if he's actually addable/claimable).
  const rp = rosterPositions(lg.settings);
  const limit = rp ? rp.length : null;
  const active = activeCount(snap);
  const needsDrop = limit && active != null ? active >= limit : null;
  const rr = {
    ...base,
    needsDrop,
    activeCount: active,
    rosterLimit: limit,
    budgetLeft: null, // FAAB spent is not on the public roster read used here
  };

  // Free agent vs waiver: a recently-dropped player is on waivers for the
  // league's waiver_clear_days. Without the transactions read (PARTIAL) or the
  // window setting we say UNKNOWN rather than guess.
  if (snap.recentDrops === null) {
    return { ...rr, state: "UNKNOWN", detail: "Unrostered, but recent transactions couldn't be read, so free agent vs waiver is unconfirmed." };
  }
  const clearDays = numSetting(lg.settings, "waiver_clear_days");
  const droppedAt = snap.recentDrops[player.id];
  if (droppedAt != null) {
    if (clearDays == null) {
      return { ...rr, state: "UNKNOWN", detail: "Recently dropped, but this league's waiver window setting is missing — can't tell if he has cleared." };
    }
    if (now - droppedAt < clearDays * DAY) {
      const hrsLeft = Math.max(1, Math.round((clearDays * DAY - (now - droppedAt)) / 3_600_000));
      return { ...rr, state: "WAIVER", detail: `Dropped recently; on waivers for ~${hrsLeft}h more (${clearDays}-day window).` };
    }
    return { ...rr, state: "AVAILABLE", detail: `Unrostered; his recent drop is outside the ${clearDays}-day waiver window.` };
  }
  if (clearDays != null && clearDays > 7) {
    return { ...rr, state: "UNKNOWN", detail: `Unrostered, but this league's ${clearDays}-day waiver window is longer than the transaction history checked.` };
  }
  return { ...rr, state: "AVAILABLE", detail: "Unrostered and no recent drop found — free agent." };
}

export type { AvailState };
