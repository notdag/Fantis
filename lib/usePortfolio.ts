"use client";

// Cross-league "portfolio" view — inspired by StatChasers' Redraft Command
// Center concept (a multi-league dashboard aggregating standings/exposure
// across every league at once), rebuilt from scratch on Fantis's own real
// data. Nothing here is copied from their product — no rankings, no
// design, no text — just the general idea of aggregating a user's *own*
// already-synced leagues instead of viewing one at a time.
//
// One shared fetch (getRosters per league — real Sleeper data, no new
// source) powers every section: it returns every team's roster in that
// league, which gives us both "my roster" (owner_id match) and "everyone
// else's roster" (for the real per-league power-rank comparison).
import { useEffect, useMemo, useState } from "react";
import { getLeagueUsers, getPlayers, getRosters, getState, getTransactions } from "./sleeper";
import { PLAYERS } from "./players";
import { stripSuffix } from "./playerIdMap";
import { useTradeValues } from "./useTradeValues";
import { useFantasyCalcValues, fantasyCalcValue } from "./fantasyCalc";
import type {
  PlayerMap,
  SleeperLeague,
  SleeperLeagueUser,
  SleeperRoster,
  SleeperTransaction,
} from "./types";

export interface PortfolioLeagueRow {
  lg: SleeperLeague;
  myRoster: SleeperRoster | null;
  value: number;
  powerRank: number | null; // my roster's real trade-value rank among every team in this league
  powerTotal: number; // team count actually rostered (may be < total_rosters for an empty slot)
  fcPowerRank: number | null; // same idea, ranked by FantasyCalc's own value instead — see lib/fantasyCalc.ts
}

export interface RecordSnapshot {
  winning: number;
  even: number;
  losing: number;
}

const POWER_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type DepthTier = "Thin" | "Average" | "Strong";
export interface PositionalDepthRow {
  pos: (typeof POWER_POSITIONS)[number];
  avgValue: number;
  tier: DepthTier;
}

export interface ExposureRow {
  playerId: string;
  name: string;
  pos: string;
  team: string;
  inj: string | null;
  count: number;
  totalLeagues: number;
  value: number; // this one player's real curated trade value
  leagueNames: string[];
}

// A real trade offer someone else sent you, pulled from Sleeper's own
// transaction log — see the fetch effect below for the "which weeks do we
// check" tradeoff. Informational only: Fantis has no write access to
// Sleeper (read-only public API, no OAuth — see CLAUDE.md), so there's no
// in-app accept/decline, just a real, clickable "here's what you've been
// sent" surface.
export interface TradeRow {
  leagueId: string;
  leagueName: string;
  transactionId: string;
  createdAt: number;
  status: string; // "pending" | "complete" | "failed" — Sleeper's own status
  waitingOnMe: boolean; // only meaningful while status is "pending"
  otherTeamName: string;
  myGets: string[];
  myGives: string[];
}

export function usePortfolio(leagues: SleeperLeague[], myUserId: string | null) {
  const values = useTradeValues();
  const fcValues = useFantasyCalcValues();
  const [pmap, setPmap] = useState<PlayerMap | null>(null);
  const [rostersByLeague, setRostersByLeague] = useState<Record<string, SleeperRoster[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentLeg, setCurrentLeg] = useState<number | null>(null);
  const [transactionsByLeague, setTransactionsByLeague] = useState<
    Record<string, SleeperTransaction[]>
  >({});
  const [usersByLeague, setUsersByLeague] = useState<Record<string, SleeperLeagueUser[]>>({});

  useEffect(() => {
    let cancelled = false;
    getPlayers()
      .then((m) => {
        if (!cancelled) setPmap(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const leagueIds = leagues.map((l) => l.league_id).join(",");

  useEffect(() => {
    if (leagues.length === 0 || !myUserId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all(
      leagues.map((lg) =>
        getRosters(lg.league_id)
          .then((rosters) => [lg.league_id, rosters] as const)
          .catch(() => [lg.league_id, null] as const)
      )
    )
      .then((results) => {
        if (cancelled) return;
        const map: Record<string, SleeperRoster[]> = {};
        for (const [id, rosters] of results) {
          if (rosters) map[id] = rosters;
        }
        setRostersByLeague(map);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your league rosters.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueIds, myUserId]);

  useEffect(() => {
    let cancelled = false;
    getState()
      .then((s) => {
        // Sleeper's "leg" lags behind "week" during preseason (leg stays 0
        // while week already reads 1, confirmed against real transaction
        // data — trades made before week 1 kicks off are still filed under
        // round 1, not round 0). Use whichever is higher so early-season
        // trades aren't missed.
        if (!cancelled) setCurrentLeg(Math.max(s.week, s.leg));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Trades received: only checked once rosters (for myRoster's real
  // roster_id per league) and the current leg are both known. Scans every
  // round from week 0 through the current leg for each league — real, full
  // season-to-date coverage rather than a narrow recent-only window. Right
  // now (preseason/early season) that's 1-2 rounds per league; it grows as
  // the season goes, up to a real ceiling of 18 rounds x however many
  // leagues you're in by season's end. Kept as one Promise.all rather than
  // batching, since the browser's own per-origin connection limit already
  // throttles this — documented cost, not silently unbounded.
  useEffect(() => {
    if (currentLeg == null || myUserId == null) return;
    const leagueEntries = Object.entries(rostersByLeague);
    if (leagueEntries.length === 0) return;
    let cancelled = false;
    const rounds = Array.from({ length: currentLeg + 1 }, (_, i) => i);

    Promise.all(
      leagueEntries.map(async ([leagueId, rosters]) => {
        const myRoster = rosters.find((r) => r.owner_id === myUserId);
        if (!myRoster) return [leagueId, [] as SleeperTransaction[]] as const;
        const perRound = await Promise.all(
          rounds.map((r) => getTransactions(leagueId, r).catch((): SleeperTransaction[] => []))
        );
        // "Received" = someone else proposed it, not trades I sent myself.
        const received = perRound
          .flat()
          .filter(
            (t) =>
              t.type === "trade" &&
              t.creator !== myUserId &&
              (t.roster_ids ?? []).includes(myRoster.roster_id)
          );
        return [leagueId, received] as const;
      })
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, SleeperTransaction[]> = {};
      for (const [id, txns] of results) if (txns.length > 0) map[id] = txns;
      setTransactionsByLeague(map);
    });

    return () => {
      cancelled = true;
    };
  }, [currentLeg, myUserId, rostersByLeague]);

  // Team names for the leagues that actually have a received trade, not
  // every league — the vast majority won't, so this avoids a wasted
  // getLeagueUsers call per league on every load.
  useEffect(() => {
    const ids = Object.keys(transactionsByLeague);
    if (ids.length === 0) return;
    let cancelled = false;
    Promise.all(
      ids.map((id) =>
        getLeagueUsers(id)
          .then((users) => [id, users] as const)
          .catch((): readonly [string, SleeperLeagueUser[]] => [id, []])
      )
    ).then((results) => {
      if (cancelled) return;
      setUsersByLeague((prev) => {
        const next = { ...prev };
        for (const [id, users] of results) next[id] = users;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [transactionsByLeague]);

  const playerByName = useMemo(() => {
    const map: Record<string, (typeof PLAYERS)[number]> = {};
    for (const p of PLAYERS) map[p.name] = p;
    return map;
  }, []);

  const data = useMemo(() => {
    const overview: PortfolioLeagueRow[] = [];
    const exposureMap = new Map<string, ExposureRow>();
    const posValueTotals: Record<(typeof POWER_POSITIONS)[number], number> = {
      QB: 0,
      RB: 0,
      WR: 0,
      TE: 0,
    };
    let leaguesCountedForDepth = 0;

    if (!pmap || !myUserId) {
      return {
        overview,
        exposure: [] as ExposureRow[],
        recordSnapshot: { winning: 0, even: 0, losing: 0 } as RecordSnapshot,
        positionalDepth: [] as PositionalDepthRow[],
      };
    }

    // Real value of one roster (any team, not just mine) — same trade-value
    // sum used for "my roster value" below, reused to rank every team in a
    // league against each other for a real power-rank/standing, with no
    // extra fetch: getRosters already returns every team, not just mine.
    const rosterValue = (roster: SleeperRoster): number => {
      let total = 0;
      for (const id of roster.players ?? []) {
        const entry = pmap[id];
        if (!entry) continue;
        const curated = playerByName[entry.n] ?? playerByName[stripSuffix(entry.n)];
        if (!curated) continue;
        total += values[curated.name]?.value ?? 0;
      }
      return total;
    };

    // Same idea, summed from FantasyCalc's own real published values
    // instead of Fantis's — a second, independently-sourced power rank,
    // not blended into the one above. Matched directly off Sleeper's
    // name+position (not routed through our curated list), since
    // FantasyCalc's own player pool is broader than our curated set.
    const fcRosterValue = (roster: SleeperRoster): number => {
      if (!fcValues) return 0;
      let total = 0;
      for (const id of roster.players ?? []) {
        const entry = pmap[id];
        if (!entry) continue;
        total += fantasyCalcValue(fcValues, { name: entry.n, pos: entry.p });
      }
      return total;
    };

    let leaguesWithRoster = 0;
    const recordSnapshot: RecordSnapshot = { winning: 0, even: 0, losing: 0 };

    for (const lg of leagues) {
      const rosters = rostersByLeague[lg.league_id];
      if (!rosters) continue;
      const myRoster = rosters.find((r) => r.owner_id === myUserId) ?? null;
      const value = myRoster ? rosterValue(myRoster) : 0;

      // Real standing within this specific league: every team's roster
      // value, ranked — not a global number, since "power" only means
      // something relative to the teams you're actually playing against.
      let powerRank: number | null = null;
      let fcPowerRank: number | null = null;
      const rostersWithTeam = rosters.filter((r) => (r.players?.length ?? 0) > 0);
      if (myRoster) {
        const ranked = rostersWithTeam
          .map((r) => ({ rid: r.roster_id, v: rosterValue(r) }))
          .sort((a, b) => b.v - a.v);
        const idx = ranked.findIndex((r) => r.rid === myRoster.roster_id);
        powerRank = idx >= 0 ? idx + 1 : null;

        if (fcValues) {
          const fcRanked = rostersWithTeam
            .map((r) => ({ rid: r.roster_id, v: fcRosterValue(r) }))
            .sort((a, b) => b.v - a.v);
          const fcIdx = fcRanked.findIndex((r) => r.rid === myRoster.roster_id);
          fcPowerRank = fcIdx >= 0 ? fcIdx + 1 : null;
        }
      }
      overview.push({ lg, myRoster, value, powerRank, powerTotal: rostersWithTeam.length, fcPowerRank });

      if (!myRoster) continue;
      leaguesWithRoster += 1;

      const w = myRoster.settings?.wins ?? 0;
      const l = myRoster.settings?.losses ?? 0;
      if (w > l) recordSnapshot.winning += 1;
      else if (l > w) recordSnapshot.losing += 1;
      else recordSnapshot.even += 1;

      if (myRoster.players) {
        leaguesCountedForDepth += 1;
        for (const id of myRoster.players) {
          const entry = pmap[id];
          if (!entry) continue;
          if ((POWER_POSITIONS as readonly string[]).includes(entry.p)) {
            const curated = playerByName[entry.n] ?? playerByName[stripSuffix(entry.n)];
            const val = curated ? values[curated.name]?.value ?? 0 : 0;
            posValueTotals[entry.p as (typeof POWER_POSITIONS)[number]] += val;
          }
        }
      }

      if (myRoster.players) {
        for (const id of myRoster.players) {
          const entry = pmap[id];
          if (!entry || !["QB", "RB", "WR", "TE"].includes(entry.p)) continue;
          const curated = playerByName[entry.n] ?? playerByName[stripSuffix(entry.n)];
          const row = exposureMap.get(id) ?? {
            playerId: id,
            name: entry.n,
            pos: entry.p,
            team: entry.t,
            inj: entry.inj ?? null,
            count: 0,
            totalLeagues: 0,
            value: curated ? values[curated.name]?.value ?? 0 : 0,
            leagueNames: [],
          };
          row.count += 1;
          row.leagueNames.push(lg.name);
          exposureMap.set(id, row);
        }
      }

    }

    for (const row of exposureMap.values()) row.totalLeagues = leaguesWithRoster;

    overview.sort((a, b) => b.value - a.value);
    const exposure = [...exposureMap.values()].sort((a, b) => b.count - a.count);

    // Self-relative depth tiering: each position's real average roster
    // value (across your leagues) compared against the average of your
    // *own* four positions — not an external market benchmark, which we
    // can't rigorously build from a per-player pool average without
    // conflating "one player's value" with "a full roster spot's value".
    // This answers "which of my positions is comparatively strong or thin
    // relative to my other positions", which is real and honest; it isn't
    // a claim about being strong/thin vs. the wider league.
    const avgByPos = POWER_POSITIONS.map((pos) => ({
      pos,
      avgValue: leaguesCountedForDepth > 0 ? posValueTotals[pos] / leaguesCountedForDepth : 0,
    }));
    const overallAvg = avgByPos.reduce((sum, r) => sum + r.avgValue, 0) / (avgByPos.length || 1);
    const positionalDepth: PositionalDepthRow[] = avgByPos.map(({ pos, avgValue }) => {
      const ratio = overallAvg > 0 ? avgValue / overallAvg : 1;
      const tier: DepthTier = ratio >= 1.15 ? "Strong" : ratio <= 0.85 ? "Thin" : "Average";
      return { pos, avgValue, tier };
    });

    return { overview, exposure, recordSnapshot, positionalDepth };
  }, [pmap, myUserId, leagues, rostersByLeague, playerByName, values, fcValues]);

  const receivedTrades = useMemo(() => {
    const rows: TradeRow[] = [];
    if (!pmap || !myUserId) return rows;

    const playerName = (id: string) => pmap[id]?.n ?? id;

    for (const lg of leagues) {
      const txns = transactionsByLeague[lg.league_id];
      const rosters = rostersByLeague[lg.league_id];
      if (!txns || !rosters) continue;
      const myRoster = rosters.find((r) => r.owner_id === myUserId);
      if (!myRoster) continue;
      const users = usersByLeague[lg.league_id] ?? [];

      for (const t of txns) {
        const otherRid = (t.roster_ids ?? []).find((r) => r !== myRoster.roster_id);
        const otherRoster = rosters.find((r) => r.roster_id === otherRid);
        const otherUser = users.find((u) => u.user_id === otherRoster?.owner_id);
        const otherTeamName =
          otherUser?.metadata?.team_name || otherUser?.display_name || `Team ${otherRid ?? "?"}`;

        const myGets = Object.entries(t.adds ?? {})
          .filter(([, rid]) => rid === myRoster.roster_id)
          .map(([id]) => playerName(id));
        const myGives = Object.entries(t.drops ?? {})
          .filter(([, rid]) => rid === myRoster.roster_id)
          .map(([id]) => playerName(id));
        const waitingOnMe = !(t.consenter_ids ?? []).includes(myRoster.roster_id);

        rows.push({
          leagueId: lg.league_id,
          leagueName: lg.name,
          transactionId: t.transaction_id,
          createdAt: t.created,
          status: t.status,
          waitingOnMe,
          otherTeamName,
          myGets,
          myGives,
        });
      }
    }

    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }, [pmap, myUserId, leagues, transactionsByLeague, rostersByLeague, usersByLeague]);

  return {
    ...data,
    receivedTrades,
    loading,
    error,
    leaguesLoaded: Object.keys(rostersByLeague).length,
    leaguesTotal: leagues.length,
  };
}
