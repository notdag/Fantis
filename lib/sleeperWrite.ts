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
// The mutations below are ported from a real, unofficial community
// reference (a GitHub PR against an open-source Sleeper SDK) — evidenced,
// not guessed, but still a single unverified contribution against
// Sleeper's undocumented private schema. Never assume a call succeeded
// just because fetch() didn't throw: Sleeper returns errors as HTTP 200
// with a body `errors` array, not an HTTP error status.

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

export interface MoveToIRResult {
  reserve: string[];
}

export async function moveToIR(
  token: string,
  params: { leagueId: string; rosterId: number; playerId: string }
): Promise<MoveToIRResult> {
  assertClientSide();
  const query = `
    mutation move_to_ir($league_id: Snowflake!, $roster_id: Int!, $player_id: String!) {
      move_to_ir(league_id: $league_id, roster_id: $roster_id, player_id: $player_id) {
        roster_id
        reserve
      }
    }
  `;
  const data = await gql<{ move_to_ir: MoveToIRResult }>(token, "move_to_ir", query, {
    league_id: assertNumeric(params.leagueId, "leagueId"),
    roster_id: Math.trunc(params.rosterId),
    player_id: params.playerId,
  });
  return data.move_to_ir;
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
  const query = `
    mutation activate_from_ir($league_id: Snowflake!, $roster_id: Int!, $player_id: String!) {
      activate_from_ir(league_id: $league_id, roster_id: $roster_id, player_id: $player_id) {
        roster_id
        reserve
        players
      }
    }
  `;
  const data = await gql<{ activate_from_ir: ActivateFromIRResult }>(
    token,
    "activate_from_ir",
    query,
    {
      league_id: assertNumeric(params.leagueId, "leagueId"),
      roster_id: Math.trunc(params.rosterId),
      player_id: params.playerId,
    }
  );
  return data.activate_from_ir;
}

export interface TransactionResult {
  transaction_id: string;
  status: string;
  type: string;
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
}

// Free-agent add and/or drop in one transaction (either side optional, at
// least one required). `adds`/`drops` are {playerId: rosterId} maps — the
// shape the reference client sends. Also used for a pure drop.
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
    mutation create_free_agent($league_id: Snowflake!, $roster_id: Int!, $adds: JSON, $drops: JSON) {
      create_free_agent(league_id: $league_id, roster_id: $roster_id, adds: $adds, drops: $drops) {
        transaction_id status type created adds drops
      }
    }
  `;
  const data = await gql<{ create_free_agent: TransactionResult }>(token, "create_free_agent", query, {
    league_id: assertNumeric(params.leagueId, "leagueId"),
    roster_id: rosterId,
    adds: params.addPlayerId ? { [params.addPlayerId]: rosterId } : {},
    drops: params.dropPlayerId ? { [params.dropPlayerId]: rosterId } : {},
  });
  return data.create_free_agent;
}

// Waiver claim (FAAB bid in dollars, 0 for priority-based leagues).
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
    mutation create_waiver_claim($league_id: Snowflake!, $roster_id: Int!, $adds: JSON, $drops: JSON, $waiver_budget: Int) {
      create_waiver_claim(league_id: $league_id, roster_id: $roster_id, adds: $adds, drops: $drops, waiver_budget: $waiver_budget) {
        transaction_id status type created adds drops settings
      }
    }
  `;
  const data = await gql<{ create_waiver_claim: TransactionResult }>(token, "create_waiver_claim", query, {
    league_id: assertNumeric(params.leagueId, "leagueId"),
    roster_id: rosterId,
    adds: { [params.addPlayerId]: rosterId },
    drops: params.dropPlayerId ? { [params.dropPlayerId]: rosterId } : {},
    waiver_budget: Math.max(0, Math.trunc(params.bid)),
  });
  return data.create_waiver_claim;
}

// Fast-follow candidates using this same gql() transport, not built yet:
// cancel_waiver_claim, move_to_taxi, propose_trade/accept_trade/
// reject_trade/cancel_trade.
