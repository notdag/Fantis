// Real write access to Sleeper — CLIENT-ONLY. Sleeper's public REST API
// (lib/sleeper.ts) is read-only; there is no public write endpoint. Real
// writes go through Sleeper's own private GraphQL API at
// https://sleeper.com/graphql — the same one sleeper.com's web client
// uses, authenticated with a real Sleeper login session token (a raw JWT,
// captured by the user from their own browser's DevTools).
//
// This module must NEVER be imported by a Server Component or API route.
// The token is the user's live Sleeper session — functionally equivalent
// to a password for account-takeover purposes — so it never leaves the
// browser. Every request here goes straight from the browser to
// sleeper.com; Fantis's server never sees the token. Confirmed live via
// curl that sleeper.com/graphql sends `access-control-allow-origin: *`
// with credentials and every write method allowed, so this cross-origin
// call is genuinely permitted, not a CORS workaround.
//
// Call names/arguments are checked against the LIVE schema by
// scripts/checkSleeperSchema.mjs (run it before trusting a write path): the
// community reference these were first ported from had gone stale.
//
// The mutations below are ported from a real, unofficial community
// reference (a GitHub PR against an open-source Sleeper SDK) — evidenced,
// not guessed, but still a single unverified contribution against
// Sleeper's undocumented private schema. Never assume a call succeeded
// just because fetch() didn't throw: Sleeper returns errors as HTTP 200
// with a body `errors` array, not an HTTP error status.

import { getRosters } from "./sleeper";

const SLEEPER_GRAPHQL_URL = "https://sleeper.com/graphql";

// Guard per-call (not a bare module-top throw, which would risk firing
// during Next.js's build-time module graph analysis) — this only throws
// if an exported function here is actually INVOKED outside a browser,
// e.g. an accidental Server Component/API route call.
function assertClientSide(): void {
  if (typeof window === "undefined") {
    throw new Error(
      "lib/sleeperWrite.ts is client-only — never call it from a Server Component or API route."
    );
  }
}

export class SleeperGraphQLError extends Error {
  constructor(public readonly errors: Array<{ message?: string; code?: string }>) {
    super(errors.map((e) => e.message).filter(Boolean).join("; ") || "Sleeper rejected the request.");
    this.name = "SleeperGraphQLError";
  }
}

// league_id/roster_id are inlined as raw text into the `update_matchup_leg`
// query string below (Sleeper's own web client does the same — they are
// not accepted as GraphQL variables for that mutation), so this is the one
// real injection surface in this file. Reject anything non-numeric before
// it ever reaches string interpolation.
function assertNumeric(value: string | number, fieldName: string): string {
  const s = String(value);
  if (!/^[0-9]+$/.test(s)) {
    throw new Error(`Refusing to send a non-numeric ${fieldName}: ${JSON.stringify(value)}`);
  }
  return s;
}

async function gql<T>(
  token: string,
  opName: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(SLEEPER_GRAPHQL_URL, {
    method: "POST",
    headers: {
      // Sleeper's real format — the raw JWT, no "Bearer " prefix.
      authorization: token,
      "content-type": "application/json",
      accept: "application/json",
      origin: "https://sleeper.com",
      referer: "https://sleeper.com/",
      "x-sleeper-graphql-op": opName,
    },
    body: JSON.stringify({ operationName: opName, query, variables }),
  });

  let body: { data?: T; errors?: Array<{ message?: string; code?: string }> };
  try {
    body = await res.json();
  } catch {
    throw new Error(`Sleeper returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (body.errors && body.errors.length > 0) {
    throw new SleeperGraphQLError(body.errors);
  }
  if (!body.data) {
    throw new Error("Sleeper returned no data and no error — unexpected empty response.");
  }
  return body.data;
}

export interface SetStartersResult {
  starters: string[];
  players: string[];
}

// Sets the real weekly lineup. Sleeper's older `update_roster_starters`
// mutation no longer works in-season (per the reference source) — this is
// the current one, `update_matchup_leg`. Only `starters_games` is a real
// GraphQL variable; league_id/roster_id/leg/round/starters are inlined.
export async function setStarters(
  token: string,
  params: { leagueId: string; rosterId: number; starters: string[]; week: number }
): Promise<SetStartersResult> {
  assertClientSide();
  const leagueId = assertNumeric(params.leagueId, "leagueId");
  const rosterId = Math.trunc(params.rosterId);
  const week = Math.trunc(params.week);
  const startersJson = JSON.stringify(params.starters);
  const query = `
    mutation update_matchup_leg($starters_games: Map) {
      update_matchup_leg(
        league_id: "${leagueId}",
        roster_id: ${rosterId},
        leg: ${week},
        round: ${week},
        starters: ${startersJson},
        starters_games: $starters_games
      ) {
        league_id
        leg
        matchup_id
        roster_id
        round
        starters
        players
      }
    }
  `;
  const data = await gql<{ update_matchup_leg: SetStartersResult }>(
    token,
    "update_matchup_leg",
    query,
    { starters_games: {} }
  );
  return data.update_matchup_leg;
}


// Sleeper's real schema has no move_to_ir / activate_from_ir (those names came
// from a stale community reference - checked by introspection). IR is changed
// by SETTING the whole reserve list: roster_update_reserve(league_id,
// roster_id, reserve: [player ids]) -> Roster. Because it replaces the list
// wholesale, the current list is read fresh from Sleeper's public rosters
// endpoint right before each change - never from Fantis's possibly-stale
// synced copy, which could silently drop someone who was already on IR.
async function liveReserve(leagueId: string, rosterId: number): Promise<string[]> {
  const rosters = await getRosters(leagueId);
  const mine = rosters.find((r) => r.roster_id === rosterId);
  if (!mine) throw new Error("Couldn't find your roster in that league on Sleeper.");
  return mine.reserve ?? [];
}

async function setReserve(
  token: string,
  leagueId: string,
  rosterId: number,
  reserve: string[]
): Promise<{ reserve: string[]; players: string[] }> {
  const query = `
    mutation roster_update_reserve($league_id: Snowflake!, $roster_id: Int!, $reserve: [String]) {
      roster_update_reserve(league_id: $league_id, roster_id: $roster_id, reserve: $reserve) {
        roster_id
        reserve
        players
      }
    }
  `;
  const data = await gql<{ roster_update_reserve: { reserve: string[] | null; players: string[] | null } }>(
    token,
    "roster_update_reserve",
    query,
    { league_id: assertNumeric(leagueId, "leagueId"), roster_id: Math.trunc(rosterId), reserve }
  );
  return {
    reserve: data.roster_update_reserve.reserve ?? [],
    players: data.roster_update_reserve.players ?? [],
  };
}

export interface MoveToIRResult {
  reserve: string[];
}

export async function moveToIR(
  token: string,
  params: { leagueId: string; rosterId: number; playerId: string }
): Promise<MoveToIRResult> {
  assertClientSide();
  const current = await liveReserve(params.leagueId, params.rosterId);
  const next = current.includes(params.playerId) ? current : [...current, params.playerId];
  const result = await setReserve(token, params.leagueId, params.rosterId, next);
  return { reserve: result.reserve };
}

export interface ActivateFromIRResult {
  reserve: string[];
  players: string[];
}

export async function activateFromIR(
  token: string,
  params: { leagueId: string; rosterId: number; playerId: string }
): Promise<ActivateFromIRResult> {
  assertClientSide();
  const current = await liveReserve(params.leagueId, params.rosterId);
  return setReserve(
    token,
    params.leagueId,
    params.rosterId,
    current.filter((id) => id !== params.playerId)
  );
}

export interface TransactionResult {
  transaction_id: string;
  status: string;
  type: string;
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
}

// Free-agent add and/or drop in one transaction. The real mutation is
// league_create_transaction(type, league_id, k_adds/v_adds, k_drops/v_drops)
// - parallel arrays of player ids and the roster ids they go to/from (the
// older create_free_agent name doesn't exist in Sleeper's schema). Also used
// for a pure drop.
export async function addDropFreeAgent(
  token: string,
  params: { leagueId: string; rosterId: number; addPlayerId?: string; dropPlayerId?: string }
): Promise<TransactionResult> {
  assertClientSide();
  if (!params.addPlayerId && !params.dropPlayerId) {
    throw new Error("addDropFreeAgent needs an add, a drop, or both.");
  }
  const rosterId = Math.trunc(params.rosterId);
  const query = `
    mutation league_create_transaction(
      $league_id: Snowflake!, $k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int]
    ) {
      league_create_transaction(
        type: "free_agent", league_id: $league_id,
        k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops
      ) { transaction_id status type created adds drops }
    }
  `;
  const data = await gql<{ league_create_transaction: TransactionResult }>(
    token,
    "league_create_transaction",
    query,
    {
      league_id: assertNumeric(params.leagueId, "leagueId"),
      k_adds: params.addPlayerId ? [params.addPlayerId] : [],
      v_adds: params.addPlayerId ? [rosterId] : [],
      k_drops: params.dropPlayerId ? [params.dropPlayerId] : [],
      v_drops: params.dropPlayerId ? [rosterId] : [],
    }
  );
  return data.league_create_transaction;
}

// Waiver claim: submit_waiver_claim with the same parallel-array shape plus
// the FAAB bid as a setting (waiver_bid - the key Sleeper reports on
// transactions). Bid is 0 for priority-based leagues.
export async function claimWaiver(
  token: string,
  params: {
    leagueId: string;
    rosterId: number;
    addPlayerId: string;
    dropPlayerId?: string;
    bid: number;
  }
): Promise<TransactionResult> {
  assertClientSide();
  const rosterId = Math.trunc(params.rosterId);
  const query = `
    mutation submit_waiver_claim(
      $league_id: Snowflake!, $k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int],
      $k_settings: [String], $v_settings: [Int]
    ) {
      submit_waiver_claim(
        league_id: $league_id, k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops,
        k_settings: $k_settings, v_settings: $v_settings
      ) { transaction_id status type created adds drops settings }
    }
  `;
  const data = await gql<{ submit_waiver_claim: TransactionResult }>(token, "submit_waiver_claim", query, {
    league_id: assertNumeric(params.leagueId, "leagueId"),
    k_adds: [params.addPlayerId],
    v_adds: [rosterId],
    k_drops: params.dropPlayerId ? [params.dropPlayerId] : [],
    v_drops: params.dropPlayerId ? [rosterId] : [],
    k_settings: ["waiver_bid"],
    v_settings: [Math.max(0, Math.trunc(params.bid))],
  });
  return data.submit_waiver_claim;
}

// ---- Trades & claims inbox -------------------------------------------------

export interface RawTransaction {
  transaction_id: string;
  status: string;
  type: string;
  creator?: string | null;
  consenter_ids?: number[] | null;
  roster_ids?: number[] | null;
  created?: number | null;
  leg: number;
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  metadata?: unknown;
  settings?: unknown;
  draft_picks?: string[] | null;
  waiver_budget?: string[] | null;
}

const TXN_FIELDS = `
  transaction_id status type creator consenter_ids roster_ids created leg
  adds drops metadata settings draft_picks waiver_budget
`;

// One request per league (two aliased selections): my proposed trades, and my
// most recent waiver transactions. Pending waiver status names aren't
// documented, so waivers are fetched unfiltered by status (recent 50 for MY
// roster) and classified client-side in lib/inbox.ts. Ids are inlined into
// the query text, so they're validated as numeric first.
export async function fetchLeagueTransactions(
  token: string,
  params: { leagueId: string; rosterId: number }
): Promise<{ trades: RawTransaction[]; waivers: RawTransaction[] }> {
  assertClientSide();
  const leagueId = assertNumeric(params.leagueId, "leagueId");
  const rosterId = Math.trunc(params.rosterId);
  const query = `
    query inbox_scan {
      trades: league_transactions_filtered(
        league_id: "${leagueId}", type_filters: ["trade"], status_filters: ["proposed"],
        roster_id_filters: [${rosterId}], limit: 50
      ) { ${TXN_FIELDS} }
      waivers: league_transactions_filtered(
        league_id: "${leagueId}", type_filters: ["waiver"],
        roster_id_filters: [${rosterId}], limit: 50
      ) { ${TXN_FIELDS} }
    }
  `;
  const data = await gql<{ trades: RawTransaction[] | null; waivers: RawTransaction[] | null }>(
    token,
    "inbox_scan",
    query
  );
  return { trades: data.trades ?? [], waivers: data.waivers ?? [] };
}

async function txnAction(
  token: string,
  op: "accept_trade" | "reject_trade" | "cancel_waiver_claim",
  params: { leagueId: string; transactionId: string; leg: number }
): Promise<{ transaction_id: string; status: string }> {
  assertClientSide();
  const query = `
    mutation ${op}($league_id: Snowflake!, $transaction_id: Snowflake!, $leg: Int!) {
      ${op}(league_id: $league_id, transaction_id: $transaction_id, leg: $leg) {
        transaction_id status type created
      }
    }
  `;
  const data = await gql<Record<string, { transaction_id: string; status: string }>>(token, op, query, {
    league_id: assertNumeric(params.leagueId, "leagueId"),
    transaction_id: assertNumeric(params.transactionId, "transactionId"),
    leg: Math.trunc(params.leg),
  });
  return data[op];
}

export const acceptTrade = (t: string, p: { leagueId: string; transactionId: string; leg: number }) => txnAction(t, "accept_trade", p);
export const rejectTrade = (t: string, p: { leagueId: string; transactionId: string; leg: number }) => txnAction(t, "reject_trade", p);
// Sleeper's schema has no cancel_trade (checked by introspection). Withdrawing
// your own proposed offer is assumed to go through reject_trade - unverified,
// so the first real cancel should be checked on sleeper.com.
export const cancelTrade = (t: string, p: { leagueId: string; transactionId: string; leg: number }) => txnAction(t, "reject_trade", p);
export const cancelWaiverClaim = (t: string, p: { leagueId: string; transactionId: string; leg: number }) => txnAction(t, "cancel_waiver_claim", p);

// Fast-follow candidates using this same gql() transport, not built yet:
// move_to_taxi, propose_trade.
