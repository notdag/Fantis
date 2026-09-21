// The ONLY door between the Command Center and Fantis/Sleeper data. Every tool
// here is read-only; there is deliberately no write tool, and this module must
// never import lib/sleeperWrite.ts (checked by scripts/testCommandCenter.ts).
// The engine calls these by name; nothing else may fetch league data, and a tool
// result is always real data or an explicit error — never invented.
import type { PlayerMap } from "../types";
import { fetchSnapshot, positionEligible, type SnapshotDeps } from "./classify";
import { cardOf, buildPlayerIndex, findMentions, resolveName, type PlayerIndex, type Resolution } from "./resolve";
import type { CcLeague, LeagueSnapshot, PlayerCard, SnapRoster } from "./types";
import { CURRENT_PERMISSION } from "./types";

export interface RawMatchup {
  roster_id: number;
  matchup_id: number | null;
  starters: string[] | null;
  points: number | null;
}

export interface ToolDeps {
  week?: number; // the NFL week matchups are read for
  getMatchups?: (leagueId: string, week: number) => Promise<RawMatchup[]>;
  leagues: CcLeague[];
  pmap: PlayerMap;
  snapshotDeps: SnapshotDeps;
  currentLeg: number;
  now?: () => number;
  ttlMs?: number; // how long a league snapshot may be reused
}

export interface ToolCall {
  tool: string;
  arg?: string;
  at: number;
}

// The names of every tool that exists. Anything not in this list can't be
// called, which is how "the model can't bypass the tool layer" is enforced.
export const READ_TOOLS = [
  "get_my_leagues",
  "get_league_details",
  "get_my_roster",
  "get_roster",
  "get_player",
  "search_players",
  "get_league_players",
  "get_free_agents",
  "get_waiver_players",
  "get_league_settings",
  "get_transactions",
  "get_league_snapshot",
  "get_matchup",
] as const;

export function createReadOnlyTools(deps: ToolDeps) {
  const now = deps.now ?? (() => Date.now());
  const ttl = deps.ttlMs ?? 5 * 60_000;
  const index: PlayerIndex = buildPlayerIndex(deps.pmap);
  const byId = new Map(deps.leagues.map((l) => [l.id, l]));
  const cache = new Map<string, { snap: LeagueSnapshot; withTx: boolean }>();
  const inflight = new Map<string, Promise<LeagueSnapshot>>();
  const log: ToolCall[] = [];
  const rec = (tool: string, arg?: string) => void log.push({ tool, arg, at: now() });
  const league = (id: string) => {
    const l = byId.get(id);
    if (!l) throw new Error(`Unknown league ${id}`); // never guess a league
    return l;
  };

  async function snapshot(leagueId: string, withTransactions = true, force = false): Promise<LeagueSnapshot> {
    rec("get_league_snapshot", leagueId);
    const lg = league(leagueId);
    const hit = cache.get(leagueId);
    // Only successful/partial reads are reused; a FAILED league is always retried.
    if (!force && hit && hit.snap.status !== "FAILED" && now() - hit.snap.fetchedAt < ttl && (hit.withTx || !withTransactions)) {
      return hit.snap;
    }
    const key = `${leagueId}:${withTransactions}`;
    const running = inflight.get(key);
    if (running) return running;
    const p = fetchSnapshot(lg, deps.snapshotDeps, now(), deps.currentLeg, withTransactions).then((snap) => {
      cache.set(leagueId, { snap, withTx: withTransactions });
      return snap;
    });
    inflight.set(key, p);
    try {
      return await p;
    } finally {
      inflight.delete(key);
    }
  }

  const rostered = async (leagueId: string): Promise<Set<string>> => {
    const s = await snapshot(leagueId, false);
    if (!s.rosters) throw new Error(s.error ?? "league could not be read");
    return new Set(s.rosters.flatMap((r) => r.players));
  };

  return {
    permission: CURRENT_PERMISSION,
    index,
    callLog: log,

    get_my_leagues: (): CcLeague[] => {
      rec("get_my_leagues");
      return deps.leagues;
    },
    get_league_details: (leagueId: string): CcLeague => {
      rec("get_league_details", leagueId);
      return league(leagueId);
    },
    get_league_settings: (leagueId: string): unknown => {
      rec("get_league_settings", leagueId);
      return league(leagueId).settings;
    },
    get_league_snapshot: snapshot,
    get_my_roster: async (leagueId: string): Promise<SnapRoster> => {
      rec("get_my_roster", leagueId);
      const s = await snapshot(leagueId, false);
      const mine = s.rosters?.find((r) => r.rosterId === s.league.rosterId);
      if (!mine || s.status === "FAILED") throw new Error(s.error ?? "roster unavailable");
      return mine;
    },
    get_roster: async (leagueId: string, rosterId: number): Promise<SnapRoster> => {
      rec("get_roster", `${leagueId}/${rosterId}`);
      const s = await snapshot(leagueId, false);
      const r = s.rosters?.find((x) => x.rosterId === rosterId);
      if (!r) throw new Error(s.error ?? `roster ${rosterId} not found`);
      return r;
    },
    get_player: (playerId: string): PlayerCard | null => {
      rec("get_player", playerId);
      return cardOf(deps.pmap, playerId);
    },
    search_players: (query: string): Resolution => {
      rec("search_players", query);
      return resolveName(query, index);
    },
    find_player_mentions: (text: string) => findMentions(text, index),
    get_league_players: async (leagueId: string): Promise<string[]> => {
      rec("get_league_players", leagueId);
      return [...(await rostered(leagueId))];
    },
    // Unrostered, fantasy-relevant, position-eligible players (no waiver split).
    get_free_agents: async (leagueId: string): Promise<string[]> => {
      rec("get_free_agents", leagueId);
      const taken = await rostered(leagueId);
      const lg = league(leagueId);
      const out: string[] = [];
      for (const [id, e] of Object.entries(deps.pmap)) {
        if (!e.t || taken.has(id)) continue;
        if (positionEligible(lg.settings, e.p) !== true) continue;
        out.push(id);
      }
      return out;
    },
    // Unrostered players dropped inside the league's waiver window.
    get_waiver_players: async (leagueId: string): Promise<string[]> => {
      rec("get_waiver_players", leagueId);
      const s = await snapshot(leagueId, true);
      if (!s.rosters || s.recentDrops === null) throw new Error(s.error ?? "transactions unavailable");
      const taken = new Set(s.rosters.flatMap((r) => r.players));
      return Object.keys(s.recentDrops).filter((id) => !taken.has(id));
    },
    // My matchup this week: my starters and my opponent's (null = bye / no opponent).
    get_matchup: async (leagueId: string) => {
      rec("get_matchup", leagueId);
      const lg = league(leagueId);
      if (!deps.getMatchups || deps.week == null) throw new Error("matchup data is not available");
      const rows = await deps.getMatchups(leagueId, deps.week);
      if (!Array.isArray(rows)) throw new Error("no matchup data returned");
      const mine = rows.find((r) => r.roster_id === lg.rosterId);
      if (!mine) throw new Error("my roster is not in this week's matchups");
      const opp =
        mine.matchup_id == null ? null : rows.find((r) => r.roster_id !== mine.roster_id && r.matchup_id === mine.matchup_id) ?? null;
      return { mine, opp, week: deps.week };
    },
    get_transactions: async (leagueId: string): Promise<Record<string, number>> => {
      rec("get_transactions", leagueId);
      const s = await snapshot(leagueId, true);
      if (s.recentDrops === null) throw new Error(s.error ?? "transactions unavailable");
      return s.recentDrops;
    },
  };
}

export type ReadOnlyTools = ReturnType<typeof createReadOnlyTools>;
