// Command Center AI — shared types + the permission model.
//
// PHASE 1 IS READ-ONLY. Nothing in lib/commandCenter/** may import the Sleeper
// write layer (lib/sleeperWrite.ts) or send any request that changes Sleeper
// data; scripts/testCommandCenter.ts enforces that statically.

export type Permission = "READ_ONLY" | "PROPOSE_ONLY" | "EXECUTE_APPROVED" | "AUTO_EXECUTE";

// The one switch for the whole feature. Later phases move this up the ladder
// (READ_ONLY → PROPOSE_ONLY → EXECUTE_APPROVED); AUTO_EXECUTE is deliberately
// not wired to anything.
export const CURRENT_PERMISSION: Permission = "READ_ONLY";

export const canExecute = (p: Permission = CURRENT_PERMISSION) =>
  p === "EXECUTE_APPROVED" || p === "AUTO_EXECUTE";

// Every classified state stays distinct — never collapsed together.
export type AvailState =
  | "AVAILABLE" // unrostered, no recent drop inside the league's waiver window
  | "WAIVER" // unrostered but recently dropped, so it's a claim not an add
  | "ON_MY_ROSTER"
  | "ON_OTHER_ROSTER"
  | "NOT_ELIGIBLE" // the league has no roster slot this position can fill
  | "UNKNOWN" // scanned, but the data needed to decide was missing
  | "SCAN_FAILED"; // the league could not be read at all

export const STATE_ORDER: AvailState[] = [
  "AVAILABLE",
  "WAIVER",
  "ON_MY_ROSTER",
  "ON_OTHER_ROSTER",
  "NOT_ELIGIBLE",
  "UNKNOWN",
  "SCAN_FAILED",
];

export const STATE_LABEL: Record<AvailState, string> = {
  AVAILABLE: "Free agent",
  WAIVER: "Waiver",
  ON_MY_ROSTER: "On my roster",
  ON_OTHER_ROSTER: "On another team",
  NOT_ELIGIBLE: "Not eligible",
  UNKNOWN: "Unknown",
  SCAN_FAILED: "Scan failed",
};

// One synced league as the Command Center sees it (no Sleeper calls needed to
// build this — it comes from Fantis's own DB).
export interface CcLeague {
  id: string;
  name: string;
  status: string; // Sleeper's own: pre_draft | drafting | in_season | complete
  settings: unknown; // slimmed raw GET /league/{id} JSON
  rosterId: number; // my roster_id in this league
  ownerId: string; // my Sleeper user_id (the roster's owner_id must match)
  bestBall: boolean;
}

export interface SnapRoster {
  rosterId: number;
  ownerId: string | null;
  players: string[];
  starters: string[];
  reserve: string[];
  taxi: string[];
  // Real season record (Sleeper's own numbers), when the roster read carried them.
  wins?: number;
  losses?: number;
  ties?: number;
  fpts?: number;
}

export type ScanStatus = "SUCCESS" | "PARTIAL" | "FAILED";

// Live read of one league. `recentDrops` is null when the transactions read
// failed (→ PARTIAL): then "unrostered" can't be split into free agent vs
// waiver, and the classifier says UNKNOWN instead of guessing.
export interface LeagueSnapshot {
  league: CcLeague;
  status: ScanStatus;
  fetchedAt: number;
  rosters: SnapRoster[] | null;
  recentDrops: Record<string, number> | null; // playerId → most recent drop (ms epoch)
  error?: string; // why it failed / went partial
}

export interface PlayerCard {
  id: string;
  name: string;
  pos: string;
  team: string;
  injury: string | null;
  active: boolean; // has a current NFL team
}

export interface LeagueResult {
  leagueId: string;
  leagueName: string;
  playerId: string;
  state: AvailState;
  detail: string; // one plain sentence: why this state
  scanStatus: ScanStatus;
  // Roster requirement for actionable states (AVAILABLE/WAIVER):
  needsDrop: boolean | null; // null = couldn't tell (roster size unknown)
  activeCount: number | null;
  rosterLimit: number | null;
  faab: boolean;
  budgetLeft: number | null;
  owner?: string; // roster id text for ON_OTHER_ROSTER
}

export interface DropReason {
  text: string;
}

export interface DropCandidate {
  playerId: string;
  name: string;
  pos: string;
  reasons: string[];
  fantisValue: number | null;
  fcValue: number | null;
  avoid: boolean;
}

export interface DropAnalysis {
  leagueId: string;
  candidates: DropCandidate[]; // up to 3, weakest first
  protectedCount: number; // roster players excluded (starters, IR, priority list, scarcity)
  poolSize: number;
  note?: string; // e.g. "fewer than 3 droppable players"
  unrankedTie: boolean; // the top of the list is ordered arbitrarily
}

// What the model is allowed to know about a player when ranking drops —
// injected so the engine stays pure/testable and the UI supplies real data.
export interface DropSignals {
  info: (id: string) => PlayerCard | null;
  fantisValue: (id: string) => number | null; // Fantis's own trade value; null = uncurated
  fcValue: (id: string) => number | null; // FantasyCalc; null = none
  curated: (id: string) => { order: number; tier: number; posRank: number } | null;
  avoid: ReadonlySet<string>;
  priority: ReadonlySet<string>;
  // FantasyCalc value in THIS league's own format (from our DB, matched by Sleeper id). When absent,
  // callers fall back to the single fixed-format `fcValue`.
  fcValueFor?: (leagueId: string, id: string) => number | null;
  priorityOrder?: string[]; // the owner's Priority list in order (index 0 = top pick), for lineup proposals
}
