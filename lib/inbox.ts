// Pure parsing for the Trades & Claims inbox: turns Sleeper's raw transaction
// rows (private GraphQL, per league) into "what do I give / get" trades and
// pending waiver claims from MY roster's point of view. No fetching, no React.
// The status strings for pending WAIVER claims are not documented anywhere, so
// waivers are classified by exclusion (anything not in a known finished
// state) and the raw status is kept on every row for calibration.
import type { RawTransaction } from "./sleeperWrite";

const PENDING_TRADE = new Set(["proposed", "pending"]);
const FINISHED = new Set(["complete", "completed", "failed", "cancelled", "canceled", "rejected", "vetoed", "expired"]);

export interface TradeSide {
  players: string[]; // Sleeper player ids
  picks: string[]; // human text, e.g. "2027 round 2"
  faab: string[]; // human text, e.g. "$15 FAAB"
}

export interface Trade {
  key: string;
  leagueId: string;
  transactionId: string;
  leg: number;
  status: string; // raw, for calibration
  created: number | null;
  direction: "incoming" | "outgoing";
  otherRosterIds: number[]; // the other teams in the deal
  give: TradeSide; // what I send
  get: TradeSide; // what I receive
}

export interface Claim {
  key: string;
  leagueId: string;
  transactionId: string;
  leg: number;
  status: string; // raw, for calibration
  created: number | null;
  addId: string | null;
  dropId: string | null;
  bid: number | null;
}

const emptySide = (): TradeSide => ({ players: [], picks: [], faab: [] });

// draft_picks entries are "originalOwnerRoster,season,round,fromRoster,toRoster"
// (per the reference client's documentation). Anything malformed is ignored
// rather than guessed at.
function pickText(entry: string): { text: string; from: number; to: number } | null {
  const p = entry.split(",").map((x) => x.trim());
  if (p.length < 5) return null;
  const [, season, round, from, to] = p;
  const f = Number(from);
  const t = Number(to);
  if (!season || !round || Number.isNaN(f) || Number.isNaN(t)) return null;
  return { text: `${season} round ${round}`, from: f, to: t };
}

// waiver_budget entries are "fromRoster-toRoster-amount".
function faabText(entry: string): { text: string; from: number; to: number } | null {
  const p = entry.split("-").map((x) => x.trim());
  if (p.length < 3) return null;
  const f = Number(p[0]);
  const t = Number(p[1]);
  const amount = Number(p[2]);
  if ([f, t, amount].some(Number.isNaN)) return null;
  return { text: `$${amount} FAAB`, from: f, to: t };
}

export function classifyTransactions(
  leagueId: string,
  myRosterId: number,
  raw: { trades: RawTransaction[]; waivers: RawTransaction[] }
): { trades: Trade[]; claims: Claim[] } {
  const trades: Trade[] = [];
  for (const t of raw.trades) {
    if (t.type !== "trade" || !PENDING_TRADE.has(t.status)) continue;
    const rosterIds = t.roster_ids ?? [];
    if (!rosterIds.includes(myRosterId)) continue;

    const give = emptySide();
    const get = emptySide();
    for (const [playerId, toRoster] of Object.entries(t.adds ?? {})) {
      if (toRoster === myRosterId) get.players.push(playerId);
    }
    for (const [playerId, fromRoster] of Object.entries(t.drops ?? {})) {
      if (fromRoster === myRosterId) give.players.push(playerId);
    }
    for (const e of t.draft_picks ?? []) {
      const pk = pickText(e);
      if (!pk) continue;
      if (pk.from === myRosterId) give.picks.push(pk.text);
      else if (pk.to === myRosterId) get.picks.push(pk.text);
    }
    for (const e of t.waiver_budget ?? []) {
      const f = faabText(e);
      if (!f) continue;
      if (f.from === myRosterId) give.faab.push(f.text);
      else if (f.to === myRosterId) get.faab.push(f.text);
    }

    // I've already consented (I proposed it, or already agreed) = outgoing;
    // otherwise it's waiting on me.
    const consented = (t.consenter_ids ?? []).includes(myRosterId);
    trades.push({
      key: `${leagueId}:${t.transaction_id}`,
      leagueId,
      transactionId: t.transaction_id,
      leg: t.leg,
      status: t.status,
      created: t.created ?? null,
      direction: consented ? "outgoing" : "incoming",
      otherRosterIds: rosterIds.filter((r) => r !== myRosterId),
      give,
      get,
    });
  }

  const claims: Claim[] = [];
  for (const w of raw.waivers) {
    if (w.type !== "waiver" || FINISHED.has(w.status)) continue;
    if (!(w.roster_ids ?? []).includes(myRosterId)) continue;
    const addId = Object.entries(w.adds ?? {}).find(([, r]) => r === myRosterId)?.[0] ?? null;
    const dropId = Object.entries(w.drops ?? {}).find(([, r]) => r === myRosterId)?.[0] ?? null;
    const settings = w.settings && typeof w.settings === "object" ? (w.settings as Record<string, unknown>) : {};
    const bid = typeof settings.waiver_bid === "number" ? settings.waiver_bid : null;
    claims.push({
      key: `${leagueId}:${w.transaction_id}`,
      leagueId,
      transactionId: w.transaction_id,
      leg: w.leg,
      status: w.status,
      created: w.created ?? null,
      addId,
      dropId,
      bid,
    });
  }
  return { trades, claims };
}
