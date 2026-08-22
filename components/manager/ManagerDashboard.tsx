"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  statusChipStyle,
  statusLabel,
  scoringFormatLabel,
  playoffFormat,
  formatRelative,
  formatUpcoming,
  alertSeverityChipStyle,
  automationConnected,
  isSnoozed,
  type ManagedAccount,
  type ManagedAlert,
  type ManagedDraft,
  type ManagedLeague,
  type ManagedSyncRun,
} from "@/lib/manager";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import { useTradeValues } from "@/lib/useTradeValues";
import { useFantasyCalcValues, fantasyCalcValue } from "@/lib/fantasyCalc";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { posChipStyle } from "@/lib/players";
import { computeLeagueRank, computeStanding, type LeagueRosterRow } from "@/lib/leagueRank";
import { IconFlag, IconCheck, IconSearch, IconUsers, IconCalendar, IconChevronRight } from "./MgrIcons";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { SectionHead } from "./PageHead";
import { LeagueAvatar, PlayerAvatar } from "./Avatar";
import { Badge } from "./Badge";

type SortKey = "name" | "teams" | "status" | "synced" | "record" | "draftTime";
type SortDir = "asc" | "desc";

const STATUSES = ["pre_draft", "drafting", "in_season", "complete"] as const;
const UNGROUPED = "__ungrouped__";

// Real, documented estimate — not a schedule simulation. Blends real
// standing (65%) and real roster-strength rank (35%) into a 0-100 score,
// scaled toward the extremes as the real season progresses (early-season
// results carry less signal), with a real bonus/penalty for being inside
// or outside the league's own real playoff cutoff line. Clamped 1-99 so
// it never claims false certainty. See "Playoff outlook" note in the UI.
const PLAYOFF_TIERS = [
  { key: "likely", label: "Likely In", min: 60 },
  { key: "bubble", label: "Bubble", min: 40 },
  { key: "outside", label: "Outside", min: 10 },
  { key: "longshot", label: "Longshot", min: 0 },
] as const;
type PlayoffTierKey = (typeof PLAYOFF_TIERS)[number]["key"];

function playoffTier(pct: number): (typeof PLAYOFF_TIERS)[number] {
  return PLAYOFF_TIERS.find((t) => pct >= t.min) ?? PLAYOFF_TIERS[PLAYOFF_TIERS.length - 1];
}

const TIER_COLOR: Record<PlayoffTierKey, string> = {
  likely: "var(--mint)",
  bubble: "var(--amber)",
  outside: "var(--muted)",
  longshot: "var(--red)",
};

function tierTone(color: string) {
  return {
    color,
    background: `color-mix(in srgb, ${color} 20%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 52%, transparent)`,
  };
}

const DEPTH_COLOR: Record<string, string> = { Strong: "var(--mint)", Average: "var(--muted)", Thin: "var(--red)" };

function computePlayoffPct(
  standing: number | null,
  totalTeams: number,
  strengthRank: number | null,
  currentWeek: number,
  playoffWeekStart: number | null,
  playoffTeams: number | null
): number | null {
  if (standing == null || totalTeams <= 1) return null;
  const standingScore = 1 - (standing - 1) / (totalTeams - 1);
  const strengthScore = strengthRank != null ? 1 - (strengthRank - 1) / (totalTeams - 1) : standingScore;
  const combined = 0.65 * standingScore + 0.35 * strengthScore;
  const seasonProgress = playoffWeekStart && playoffWeekStart > 1
    ? Math.min(1, Math.max(0, (currentWeek - 1) / (playoffWeekStart - 1)))
    : 0;
  const raw = 50 + (combined - 0.5) * 100 * (0.4 + 0.6 * seasonProgress);
  const cutoffBonus = playoffTeams != null ? (standing <= playoffTeams ? 10 : -10) : 0;
  return Math.min(99, Math.max(1, Math.round(raw + cutoffBonus * seasonProgress)));
}

export default function ManagerDashboard({
  accounts,
  leagues,
  lastRun,
  alertsByLeague,
  draftsByLeague,
  automationLastPingAt,
  rosters,
  leagueRostersByLeague,
  currentWeek,
}: {
  accounts: ManagedAccount[];
  leagues: ManagedLeague[];
  lastRun: ManagedSyncRun | null;
  alertsByLeague: Record<string, ManagedAlert[]>;
  draftsByLeague: Record<string, ManagedDraft>;
  automationLastPingAt: string | null;
  rosters: {
    leagueId: string;
    rosterId: number;
    wins: number;
    losses: number;
    ties: number;
    fpts: number | null;
    maxPtsFor: number | null;
  }[];
  leagueRostersByLeague: Record<string, LeagueRosterRow[]>;
  currentWeek: number;
}) {
  // Shared guard for every Date.now()-dependent render below
  // (automationConnected, formatRelative, formatUpcoming, draftsThisWeek) —
  // each of those differs between the server render and the client
  // hydration pass a moment later, which is a real hydration mismatch
  // (React error #418), not just cosmetic, when it changes DOM structure
  // (the connected/not-connected branch) and still worth avoiding even for
  // plain text (a relative-time string silently "jumping" on load reads as
  // a bug). Rendering the same stable placeholder on both the server pass
  // and the client's first hydration pass keeps them identical; real values
  // only take effect after hydration finishes, via this effect.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const connected = mounted && automationConnected(automationLastPingAt);
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");

  // Portfolio section (below) — same lightweight, already-proven client
  // hooks lib/usePortfolio.ts already uses for the legacy Portfolio page,
  // fed here by the Prisma props above instead of a second live-Sleeper
  // fetch.
  const { pmap } = usePlayerMap();
  const tradeValues = useTradeValues();
  const fcValues = useFantasyCalcValues();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | (typeof STATUSES)[number]>("ALL");
  const [draftFilter, setDraftFilter] = useState<"ALL" | "pre_draft" | "drafting" | "complete" | "none">("ALL");
  const [groupFilter, setGroupFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showAllClear, setShowAllClear] = useState(false);
  const [breakdownTierFilter, setBreakdownTierFilter] = useState<"ALL" | PlayoffTierKey>("ALL");
  const [showAllBreakdown, setShowAllBreakdown] = useState(false);
  const [exposureView, setExposureView] = useState<"map" | "table">("map");
  const [exposurePos, setExposurePos] = useState<"ALL" | "QB" | "RB" | "WR" | "TE">("ALL");
  const [exposureStatus, setExposureStatus] = useState<"ALL" | "INJURED" | "Questionable" | "Doubtful" | "Out" | "IR">("ALL");
  const [exposureLevel, setExposureLevel] = useState<"ALL" | "LOW" | "HIGH" | "OVER">("ALL");
  // The connect form is only useful once, for first-time setup — once at
  // least one account is already connected, it's just clutter above the
  // real "Sync now" action, so it starts collapsed behind a small link.
  const [showConnectForm, setShowConnectForm] = useState(accounts.length === 0);
  // The whole header/sync card block collapses to one compact line once
  // there's at least one connected account and nothing's actually wrong —
  // Daryl wants Today to be the first thing on screen, not setup chrome he
  // only ever needed once. Forced open on first-time setup or a real sync
  // failure, since those genuinely need to be seen, not hidden behind a click.
  const hasSyncFailure = (lastRun?.leaguesFailed ?? 0) > 0;
  const [detailsOpen, setDetailsOpen] = useState(accounts.length === 0 || hasSyncFailure);

  const connect = async () => {
    const u = username.trim();
    if (!u || connecting) return;
    setConnecting(true);
    setConnectError("");
    try {
      const res = await fetch("/api/manager/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectError(body.error || "Couldn't connect that account.");
        return;
      }
      setUsername("");
      router.refresh();
    } catch {
      setConnectError("Couldn't reach the server.");
    } finally {
      setConnecting(false);
    }
  };

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncError("");
    try {
      const res = await fetch("/api/manager/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError(body.error || "Sync failed.");
        return;
      }
      router.refresh();
    } catch {
      setSyncError("Couldn't reach the server.");
    } finally {
      setSyncing(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leagues.filter((lg) => {
      const draftStatus = draftsByLeague[lg.id]?.status ?? "none";
      return (
        (statusFilter === "ALL" || lg.status === statusFilter) &&
        (draftFilter === "ALL" || draftStatus === draftFilter) &&
        (groupFilter === "ALL" ||
          (groupFilter === UNGROUPED ? !lg.group : lg.group === groupFilter)) &&
        (!q || lg.name.toLowerCase().includes(q))
      );
    });
  }, [leagues, query, statusFilter, draftFilter, groupFilter, draftsByLeague]);

  // Per-league record lookup for the "All leagues" table's Record column
  // — same `rosters` prop already used for the portfolio aggregation
  // further down, just keyed for a single-row lookup instead of summed.
  const rosterByLeague = useMemo(() => new Map(rosters.map((r) => [r.leagueId, r])), [rosters]);

  // My real team name per league — leagueRostersByLeague already has every
  // team in every league (fetched for league-wide rank above), just keyed
  // by rosterId; find the one row matching my own rosterId per league.
  const myTeamNameByLeague = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const r of rosters) {
      const mine = (leagueRostersByLeague[r.leagueId] ?? []).find((lr) => lr.rosterId === r.rosterId);
      map.set(r.leagueId, mine?.teamName ?? null);
    }
    return map;
  }, [rosters, leagueRostersByLeague]);

  // My Portfolio (2026-08c) — ported from lib/usePortfolio.ts's exact
  // formulas (already proven on the legacy Portfolio page), fed by the
  // same Prisma-backed props this page already has instead of a second
  // live-Sleeper fetch. Fantis's own curated trade value stays primary
  // (tradeValues, keyed by curated player name); FantasyCalc is always a
  // separate, labeled rank — never blended in.
  const rosterFantisValue = useMemo(() => {
    return (players: string[]): number => {
      let total = 0;
      for (const id of players) {
        const entry = pmap?.[id];
        if (!entry) continue;
        total += tradeValues[entry.n]?.value ?? 0;
      }
      return total;
    };
  }, [pmap, tradeValues]);

  const rosterFcValue = useMemo(() => {
    return (players: string[]): number => {
      if (!fcValues) return 0;
      let total = 0;
      for (const id of players) {
        const entry = pmap?.[id];
        if (!entry) continue;
        total += fantasyCalcValue(fcValues, { name: entry.n, pos: entry.p });
      }
      return total;
    };
  }, [pmap, fcValues]);

  // Real in-league rank (both by Fantis's own value and by FantasyCalc's)
  // — my roster's real value compared against every other real roster in
  // the SAME league, exact port of usePortfolio.ts's powerRank/fcPowerRank.
  const inLeagueRankByLeague = useMemo(() => {
    const map = new Map<
      string,
      { fantisRank: number | null; fcRank: number | null; standing: number | null; totalTeams: number }
    >();
    for (const r of rosters) {
      const leagueRosters = leagueRostersByLeague[r.leagueId] ?? [];
      const withTeam = leagueRosters.filter((lr) => lr.players.length > 0);
      let fantisRank: number | null = null;
      let fcRank: number | null = null;
      if (withTeam.length > 0) {
        const fantisRanked = withTeam
          .map((lr) => ({ rid: lr.rosterId, v: rosterFantisValue(lr.players) }))
          .sort((a, b) => b.v - a.v);
        const idx = fantisRanked.findIndex((row) => row.rid === r.rosterId);
        fantisRank = idx >= 0 ? idx + 1 : null;

        if (fcValues) {
          const fcRanked = withTeam
            .map((lr) => ({ rid: lr.rosterId, v: rosterFcValue(lr.players) }))
            .sort((a, b) => b.v - a.v);
          const fcIdx = fcRanked.findIndex((row) => row.rid === r.rosterId);
          fcRank = fcIdx >= 0 ? fcIdx + 1 : null;
        }
      }
      const standingResult = computeStanding(leagueRosters, r.rosterId);
      map.set(r.leagueId, {
        fantisRank,
        fcRank,
        standing: standingResult.standing,
        totalTeams: standingResult.totalTeams,
      });
    }
    return map;
  }, [rosters, leagueRostersByLeague, rosterFantisValue, rosterFcValue, fcValues]);

  // Real Playoff % estimate per league — see computePlayoffPct's own doc
  // comment above for the real inputs/weights. Real playoff_teams/
  // playoff_week_start parsed from each league's own real settings JSON.
  const playoffPctByLeague = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const lg of leagues) {
      const rank = inLeagueRankByLeague.get(lg.id);
      if (!rank) continue;
      const { playoffTeams, playoffWeekStart } = playoffFormat(lg.settings);
      map.set(
        lg.id,
        computePlayoffPct(
          rank.standing,
          rank.totalTeams,
          rank.fantisRank,
          currentWeek,
          playoffWeekStart,
          playoffTeams
        )
      );
    }
    return map;
  }, [leagues, inLeagueRankByLeague, currentWeek]);

  const playoffOutlook = useMemo(() => {
    const counts: Record<PlayoffTierKey, number> = { likely: 0, bubble: 0, outside: 0, longshot: 0 };
    for (const pct of playoffPctByLeague.values()) {
      if (pct == null) continue;
      counts[playoffTier(pct).key] += 1;
    }
    return counts;
  }, [playoffPctByLeague]);

  // Real per-player cross-league exposure — exact port of
  // usePortfolio.ts's exposure loop, restricted to QB/RB/WR/TE.
  const EXPOSURE_POS = useMemo(() => new Set(["QB", "RB", "WR", "TE"]), []);
  const exposure = useMemo(() => {
    const map = new Map<
      string,
      { playerId: string; name: string; pos: string; team: string; inj: string | null; count: number; fantisValue: number; fcValue: number; leagueNames: string[] }
    >();
    let leaguesWithRoster = 0;
    for (const r of rosters) {
      const leagueRosters = leagueRostersByLeague[r.leagueId] ?? [];
      const mine = leagueRosters.find((lr) => lr.rosterId === r.rosterId);
      if (!mine) continue;
      leaguesWithRoster += 1;
      const lg = leagues.find((l) => l.id === r.leagueId);
      for (const id of mine.players) {
        const entry = pmap?.[id];
        if (!entry || !EXPOSURE_POS.has(entry.p)) continue;
        const row = map.get(id) ?? {
          playerId: id,
          name: entry.n,
          pos: entry.p,
          team: entry.t,
          inj: entry.inj ?? null,
          count: 0,
          fantisValue: tradeValues[entry.n]?.value ?? 0,
          fcValue: fcValues ? fantasyCalcValue(fcValues, { name: entry.n, pos: entry.p }) : 0,
          leagueNames: [],
        };
        row.count += 1;
        if (lg) row.leagueNames.push(lg.name);
        map.set(id, row);
      }
    }
    return { rows: [...map.values()].sort((a, b) => b.count - a.count), totalLeagues: leaguesWithRoster };
  }, [rosters, leagueRostersByLeague, leagues, pmap, tradeValues, fcValues, EXPOSURE_POS]);

  // Real, self-relative positional depth — exact port of
  // usePortfolio.ts's ratio-vs-own-average tiering (not an external
  // league-wide benchmark; answers "which of my positions is
  // comparatively strong relative to my other positions").
  const positionalDepth = useMemo(() => {
    const posValueTotals: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
    let leaguesCounted = 0;
    for (const r of rosters) {
      const mine = (leagueRostersByLeague[r.leagueId] ?? []).find((lr) => lr.rosterId === r.rosterId);
      if (!mine) continue;
      leaguesCounted += 1;
      for (const id of mine.players) {
        const entry = pmap?.[id];
        if (!entry || !EXPOSURE_POS.has(entry.p)) continue;
        posValueTotals[entry.p] += tradeValues[entry.n]?.value ?? 0;
      }
    }
    const avgByPos = (["QB", "RB", "WR", "TE"] as const).map((pos) => ({
      pos,
      avgValue: leaguesCounted > 0 ? posValueTotals[pos] / leaguesCounted : 0,
    }));
    const overallAvg = avgByPos.reduce((sum, r) => sum + r.avgValue, 0) / (avgByPos.length || 1);
    return avgByPos.map(({ pos, avgValue }) => {
      const ratio = overallAvg > 0 ? avgValue / overallAvg : 1;
      const tier = ratio >= 1.15 ? "Strong" : ratio <= 0.85 ? "Thin" : "Average";
      return { pos, avgValue, tier };
    });
  }, [rosters, leagueRostersByLeague, pmap, tradeValues, EXPOSURE_POS]);

  // League Breakdown rows — one per league where I have a real roster,
  // real record/FC-rank/playoff%/points-for/max-points-for/standing.
  const leagueBreakdownRows = useMemo(() => {
    const rows = rosters
      .map((r) => {
        const lg = leagues.find((l) => l.id === r.leagueId);
        if (!lg) return null;
        const rank = inLeagueRankByLeague.get(r.leagueId);
        const pct = playoffPctByLeague.get(r.leagueId) ?? null;
        return {
          league: lg,
          roster: r,
          fcRank: rank?.fcRank ?? null,
          standing: rank?.standing ?? null,
          totalTeams: rank?.totalTeams ?? lg.totalRosters,
          playoffPct: pct,
          tier: pct != null ? playoffTier(pct).key : null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
    rows.sort((a, b) => (a.standing ?? 999) - (b.standing ?? 999));
    return rows;
  }, [rosters, leagues, inLeagueRankByLeague, playoffPctByLeague]);

  const breakdownTierCounts = useMemo(() => {
    const counts: Record<PlayoffTierKey, number> = { likely: 0, bubble: 0, outside: 0, longshot: 0 };
    for (const row of leagueBreakdownRows) if (row.tier) counts[row.tier] += 1;
    return counts;
  }, [leagueBreakdownRows]);

  const filteredBreakdownRows = useMemo(
    () =>
      breakdownTierFilter === "ALL"
        ? leagueBreakdownRows
        : leagueBreakdownRows.filter((r) => r.tier === breakdownTierFilter),
    [leagueBreakdownRows, breakdownTierFilter]
  );

  // Real exposure-level thresholds — Low under 20% of your leagues, High
  // at 40%+, Over at 60%+ (a player on the majority of your rosters).
  // Documented, fixed thresholds, not fabricated significance.
  const exposureFiltered = useMemo(() => {
    const total = exposure.totalLeagues || 1;
    return exposure.rows.filter((row) => {
      if (exposurePos !== "ALL" && row.pos !== exposurePos) return false;
      if (exposureStatus === "INJURED" && !row.inj) return false;
      if (exposureStatus !== "ALL" && exposureStatus !== "INJURED" && row.inj !== exposureStatus) return false;
      const pct = row.count / total;
      if (exposureLevel === "LOW" && pct >= 0.2) return false;
      if (exposureLevel === "HIGH" && pct < 0.4) return false;
      if (exposureLevel === "OVER" && pct < 0.6) return false;
      return true;
    });
  }, [exposure, exposurePos, exposureStatus, exposureLevel]);

  const exposureStatusCounts = useMemo(() => {
    const counts = { injured: 0, Questionable: 0, Doubtful: 0, Out: 0, IR: 0 } as Record<string, number>;
    for (const row of exposure.rows) {
      if (!row.inj) continue;
      counts.injured += 1;
      if (row.inj in counts) counts[row.inj] += 1;
    }
    return counts;
  }, [exposure]);

  // Real distinct group values the owner has actually set, sorted by how
  // many leagues use each — freeform text, so this is a dropdown (unbounded
  // cardinality) rather than a chip row like the fixed status values above.
  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let ungrouped = 0;
    for (const lg of leagues) {
      if (lg.group) counts.set(lg.group, (counts.get(lg.group) ?? 0) + 1);
      else ungrouped += 1;
    }
    const named = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return { named, ungrouped };
  }, [leagues]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const rows = [...filtered];
    rows.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "teams":
          return (a.totalRosters - b.totalRosters) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "synced":
          return ((a.lastSyncedAt ?? "").localeCompare(b.lastSyncedAt ?? "")) * dir;
        case "draftTime": {
          // Same "unresolved sorts last" spirit as record/rank below —
          // a league with no synced draft or no start time isn't "earliest."
          const ta = draftsByLeague[a.id]?.startTime;
          const tb = draftsByLeague[b.id]?.startTime;
          if (ta == null && tb == null) return 0;
          if (ta == null) return 1;
          if (tb == null) return -1;
          return ta.localeCompare(tb) * dir;
        }
        case "record": {
          // Unrecorded (no synced roster yet) sorts to the bottom
          // regardless of direction — same "unranked sorts last" spirit
          // as the rank column's comparator elsewhere on this page.
          const ra = rosterByLeague.get(a.id);
          const rb = rosterByLeague.get(b.id);
          const pa = ra ? ra.wins - ra.losses : null;
          const pb = rb ? rb.wins - rb.losses : null;
          if (pa == null && pb == null) return 0;
          if (pa == null) return 1;
          if (pb == null) return -1;
          return (pa - pb) * dir;
        }
        default:
          return 0;
      }
    });
    return rows;
  }, [filtered, sortBy, sortDir, rosterByLeague, draftsByLeague]);

  // Real per-status counts (unfiltered by the search box, since the chips
  // themselves are the status filter) — shown on each chip so you know
  // what "In season" etc. actually contains before clicking it.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const lg of leagues) counts[lg.status] = (counts[lg.status] ?? 0) + 1;
    return counts;
  }, [leagues]);

  // Exception-based grouping: the whole point is that the groups themselves
  // do the triage, no filter click needed. Real Alert rows only — a league
  // with zero rows genuinely means "synced, nothing found," not "not
  // checked yet."
  //
  // draftsThisWeek below depends on Date.now(), same hydration hazard as
  // `connected` above — gated on `mounted` (in the dependency array) so it
  // stays 0 (matching the server render) until after hydration, then
  // recomputes for real.
  const groups = useMemo(() => {
    const actionRequired: { league: ManagedLeague; alerts: ManagedAlert[] }[] = [];
    const commissioner: { league: ManagedLeague; alerts: ManagedAlert[] }[] = [];
    const upcomingDrafts: { league: ManagedLeague; draft: ManagedDraft | undefined }[] = [];
    const review: { league: ManagedLeague; alerts: ManagedAlert[] }[] = [];
    const allClear: ManagedLeague[] = [];
    let draftsThisWeek = 0;

    for (const lg of leagues) {
      // Snoozed alerts are real/active (still counted toward "All clear"
      // being false), but don't clutter the exception groups — same
      // filtering as the Commissioner/Player search server pages.
      const alerts = (alertsByLeague[lg.id] ?? []).filter((a) => !isSnoozed(a));
      const required = alerts.filter((a) => a.severity === "action_required");
      const unclaimed = alerts.filter((a) => a.type === "unclaimed_team");
      const draftAlert = alerts.find((a) => a.type === "draft_upcoming");
      const otherReview = alerts.filter(
        (a) => a.severity === "review" && a.type !== "unclaimed_team" && a.type !== "draft_upcoming"
      );

      if (required.length > 0) actionRequired.push({ league: lg, alerts: required });
      if (unclaimed.length > 0) commissioner.push({ league: lg, alerts: unclaimed });
      if (draftAlert) {
        const draft = draftsByLeague[lg.id];
        upcomingDrafts.push({ league: lg, draft });
        if (mounted && draft?.startTime) {
          const days = (new Date(draft.startTime).getTime() - Date.now()) / 86400000;
          if (days >= 0 && days <= 7) draftsThisWeek += 1;
        }
      }
      if (otherReview.length > 0) review.push({ league: lg, alerts: otherReview });
      if (alerts.length === 0) allClear.push(lg);
    }

    return { actionRequired, commissioner, upcomingDrafts, review, allClear, draftsThisWeek };
  }, [leagues, alertsByLeague, draftsByLeague, mounted]);

  const mostRecentSync = leagues.reduce<string | null>((latest, lg) => {
    if (!lg.lastSyncedAt) return latest;
    if (!latest || lg.lastSyncedAt > latest) return lg.lastSyncedAt;
    return latest;
  }, null);

  // Real combined record/points across every synced roster — same
  // aggregation components/manager/MyTeams.tsx already does, so the two
  // pages should never disagree since they're the same source data.
  const portfolio = useMemo(() => {
    let wins = 0, losses = 0, ties = 0, fpts = 0, withPoints = 0;
    let winningLeagues = 0, evenLeagues = 0, losingLeagues = 0;
    for (const r of rosters) {
      wins += r.wins;
      losses += r.losses;
      ties += r.ties;
      if (r.fpts != null) {
        fpts += r.fpts;
        withPoints += 1;
      }
      if (r.wins > r.losses) winningLeagues += 1;
      else if (r.wins === r.losses) evenLeagues += 1;
      else losingLeagues += 1;
    }
    const games = wins + losses + ties;
    const winPct = games > 0 ? ((wins + ties * 0.5) / games) * 100 : null;
    const avgPts = withPoints > 0 ? fpts / withPoints : null;
    return { wins, losses, ties, winPct, totalPts: fpts, avgPts, winningLeagues, evenLeagues, losingLeagues };
  }, [rosters]);

  // Real league-wide rank per league — same computeLeagueRank() call
  // components/manager/MyTeams.tsx already proves works, fed by the same
  // day-cached season totals (no new Sleeper call) and the LeagueRoster
  // data app/manager/page.tsx now fetches for Today too.
  const seasonTotals = useSeasonTotals();
  const rankByLeague = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeLeagueRank>>();
    for (const r of rosters) {
      map.set(r.leagueId, computeLeagueRank(leagueRostersByLeague[r.leagueId] ?? [], r.rosterId, seasonTotals));
    }
    return map;
  }, [rosters, leagueRostersByLeague, seasonTotals]);

  // Same "top-half" bucketing/naming as MyTeams.tsx's totals.topHalf/
  // totals.ranked, kept identical across both pages on purpose.
  const rankSnapshot = useMemo(() => {
    let topHalf = 0, ranked = 0;
    for (const r of rankByLeague.values()) {
      if (r.rank != null) {
        ranked += 1;
        if (r.rank <= r.totalTeams / 2) topHalf += 1;
      }
    }
    return { topHalf, ranked };
  }, [rankByLeague]);

  // Real portfolio composition — every number here is a plain count over
  // already-fetched leagues/draftsByLeague, no new data. draftsByLeague
  // includes every synced draft regardless of status (app/manager/page.tsx's
  // db.draft.findMany() has no status filter), so completed vs upcoming is
  // a real split of the same real Draft rows the "Drafts & deadlines"
  // section above already uses.
  const portfolioComposition = useMemo(() => {
    let activeLeagues = 0, upcomingDrafts = 0, completedDrafts = 0;
    for (const lg of leagues) {
      if (lg.status === "in_season") activeLeagues += 1;
      const draft = draftsByLeague[lg.id];
      if (draft) {
        if (draft.status === "complete") completedDrafts += 1;
        else upcomingDrafts += 1;
      }
    }
    return { totalLeagues: leagues.length, activeLeagues, upcomingDrafts, completedDrafts };
  }, [leagues, draftsByLeague]);

  return (
    <>
      <section className="sec" style={{ paddingTop: 12, paddingBottom: detailsOpen ? undefined : 12 }}>
        <div className="field" style={{ alignItems: "center", gap: 10 }}>
          <span className="hint" style={{ margin: 0 }}>
            {leagues.length} league{leagues.length === 1 ? "" : "s"} · synced{" "}
            {mounted ? formatRelative(mostRecentSync) : "—"}
            {hasSyncFailure && (
              <span style={{ color: "var(--red)" }}> · {lastRun!.leaguesFailed} failed</span>
            )}
            {" · "}
            {connected ? (
              <span style={{ color: "var(--mint)" }}>● connected</span>
            ) : (
              <span style={{ color: "var(--dim)" }}>○ not connected</span>
            )}
          </span>
          <button className="btn ghost sm" onClick={syncNow} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button className="linklike" onClick={() => setDetailsOpen((v) => !v)} style={{ fontSize: 13 }}>
            {detailsOpen ? "Hide details" : "Details"}
          </button>
        </div>

        {detailsOpen && (
          <div className="card sync" style={{ marginTop: 12 }}>
            {showConnectForm ? (
              <div className="field">
                <input
                  className="input"
                  placeholder="Sleeper username to connect"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && connect()}
                />
                <button className="btn" onClick={connect} disabled={connecting || !username.trim()}>
                  {connecting ? "Connecting…" : "Connect"}
                </button>
                {accounts.length > 0 && (
                  <button className="btn ghost" onClick={() => setShowConnectForm(false)}>
                    Cancel
                  </button>
                )}
              </div>
            ) : (
              <button className="linklike" onClick={() => setShowConnectForm(true)} style={{ fontSize: 13 }}>
                + Connect another account
              </button>
            )}
            {connectError && <div className="err">{connectError}</div>}
            {syncError && <div className="err">{syncError}</div>}
            <div className="hint" style={{ marginTop: 8 }}>
              {accounts.length} connected account{accounts.length === 1 ? "" : "s"}
              {lastRun && (
                <>
                  {" "}
                  · last run: {lastRun.status} ({lastRun.leaguesOk}/{lastRun.leaguesSeen} leagues ok
                  {lastRun.leaguesFailed > 0 ? `, ${lastRun.leaguesFailed} failed` : ""}
                  {lastRun.finishedAt &&
                    ` in ${((new Date(lastRun.finishedAt).getTime() - new Date(lastRun.startedAt).getTime()) / 1000).toFixed(1)}s`}
                  )
                </>
              )}
            </div>
            {lastRun && (
              <div className="hint" style={{ marginTop: 2 }}>
                rosters {lastRun.rostersOk}/{lastRun.leaguesOk} · matchups {lastRun.matchupsOk}/
                {lastRun.leaguesOk} · drafts {lastRun.draftsOk}/{lastRun.leaguesOk} · transactions{" "}
                {lastRun.transactionsOk}/{lastRun.leaguesOk}
              </div>
            )}
            {!connected && (
              <div className="hint" style={{ marginTop: 4 }}>
                <a
                  className="link"
                  href="/automation/fantis-sleeper-manager.user.js"
                  target="_blank"
                  rel="noreferrer"
                >
                  Install the userscript
                </a>{" "}
                (requires Tampermonkey) to open leagues from an alert automatically.
              </div>
            )}
            {lastRun?.errors && lastRun.errors.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <DataTable>
                  {lastRun.errors.map((e, i) => (
                    <TableRow key={`${e.leagueId}-${i}`}>
                      <span className="tname" style={{ flex: 1 }}>{e.leagueName ?? e.leagueId}</span>
                      <span className="portmeta">{e.message}</span>
                    </TableRow>
                  ))}
                </DataTable>
              </div>
            )}
          </div>
        )}
      </section>

      {leagues.length > 0 && (
        <section className="sec">
          <StatCardGrid variant="grid">
            <StatCard icon={IconUsers} color="var(--muted)" label="Total leagues" value={portfolioComposition.totalLeagues} />
            <StatCard icon={IconCheck} color="var(--mint)" label="Active leagues" value={portfolioComposition.activeLeagues} />
            <StatCard icon={IconCalendar} color="var(--amber)" label="Upcoming drafts" value={portfolioComposition.upcomingDrafts} />
            <StatCard icon={IconFlag} color="var(--muted)" label="Drafted" value={portfolioComposition.completedDrafts} />
          </StatCardGrid>
        </section>
      )}

      {leagues.length > 0 && (
        <section className="sec">
          <SectionHead title="Today" right="what needs you right now" />

          <p className="hint">
            Record {portfolio.wins}-{portfolio.losses}
            {portfolio.ties > 0 ? `-${portfolio.ties}` : ""}
            {portfolio.winPct != null ? ` (${portfolio.winPct.toFixed(0)}%)` : ""} overall ·{" "}
            {rankSnapshot.ranked > 0 ? `${rankSnapshot.topHalf} of ${rankSnapshot.ranked} top-half leagues` : "no season data yet"}
            {" · "}
            {groups.draftsThisWeek} draft{groups.draftsThisWeek === 1 ? "" : "s"} this week · avg{" "}
            {portfolio.avgPts != null ? portfolio.avgPts.toFixed(1) : "—"} pts/league
          </p>

          {groups.actionRequired.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <SectionHead
                level={3}
                title="Your team"
                right={`${groups.actionRequired.length} leagues`}
                style={{ marginBottom: 8 }}
              />
              <DataTable>
                {groups.actionRequired.map(({ league, alerts }) => (
                  <TableRow as="link" href={`/manager/${league.id}`} key={league.id}>
                    <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                    <Badge tone={alertSeverityChipStyle("action_required")}>
                      {alerts.length} issue{alerts.length === 1 ? "" : "s"}
                    </Badge>
                    <span className="portmeta">
                      {alerts[0].message}
                      {alerts.length > 1 ? ` +${alerts.length - 1} more` : ""}
                    </span>
                  </TableRow>
                ))}
              </DataTable>
            </div>
          )}

          {groups.commissioner.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <SectionHead
                level={3}
                title="Commissioner"
                right={`${groups.commissioner.length} leagues`}
                style={{ marginBottom: 8 }}
              />
              <DataTable>
                {groups.commissioner.map(({ league, alerts }) => (
                  <TableRow as="link" href={`/manager/${league.id}`} key={league.id}>
                    <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                    <Badge tone={alertSeverityChipStyle("review")}>review</Badge>
                    <span className="portmeta">{alerts[0].message}</span>
                  </TableRow>
                ))}
              </DataTable>
            </div>
          )}

          {(groups.upcomingDrafts.length > 0 || groups.review.length > 0) && (
            <div style={{ marginTop: 18 }}>
              <SectionHead
                level={3}
                title="Drafts & deadlines"
                right={`${groups.upcomingDrafts.length + groups.review.length} leagues`}
                style={{ marginBottom: 8 }}
              />
              <DataTable>
                {groups.upcomingDrafts.map(({ league, draft }) => (
                  <TableRow as="link" href={`/manager/${league.id}`} key={league.id}>
                    <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                    <span className="portvalue">{mounted ? formatUpcoming(draft?.startTime) : "—"}</span>
                  </TableRow>
                ))}
                {groups.review.map(({ league, alerts }) => (
                  <TableRow as="link" href={`/manager/${league.id}`} key={league.id}>
                    <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                    <Badge tone={alertSeverityChipStyle("review")}>review</Badge>
                    <span className="portmeta">{alerts[0].message}</span>
                  </TableRow>
                ))}
              </DataTable>
            </div>
          )}

          {groups.actionRequired.length === 0 &&
            groups.commissioner.length === 0 &&
            groups.upcomingDrafts.length === 0 &&
            groups.review.length === 0 && (
              <p className="hint" style={{ marginTop: 18 }}>Nothing needs you right now.</p>
            )}
        </section>
      )}

      {groups.allClear.length > 0 && (
        <section className="sec">
          <SectionHead
            title="All clear"
            right={
              <button className="chip-filter" onClick={() => setShowAllClear((v) => !v)}>
                {showAllClear ? "Hide" : `Show ${groups.allClear.length} leagues`}
              </button>
            }
          />
          {showAllClear && (
            <DataTable>
              {groups.allClear.map((league) => (
                <TableRow as="link" href={`/manager/${league.id}`} key={league.id}>
                  <span className="tname" style={{ flex: 1 }}>{league.name}</span>
                  <Badge tone={alertSeverityChipStyle("clear")}>clear</Badge>
                </TableRow>
              ))}
            </DataTable>
          )}
        </section>
      )}

      {leagues.length === 0 ? (
        <section className="sec">
          <p className="hint">
            No leagues yet — connect a Sleeper username above to sync its real leagues in.
          </p>
        </section>
      ) : (
        <section className="sec">
          <SectionHead title="All leagues" right="browse everything, not just exceptions" />

          <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
            <input
              className="input"
              placeholder="Search leagues…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <button
              className={`chip-filter ${statusFilter === "ALL" ? "on" : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              All <span className="portmeta">{leagues.length}</span>
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={`chip-filter ${statusFilter === s ? "on" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {statusLabel(s)} <span className="portmeta">{statusCounts[s] ?? 0}</span>
              </button>
            ))}
            <select
              className="select sm"
              value={draftFilter}
              onChange={(e) => setDraftFilter(e.target.value as typeof draftFilter)}
            >
              <option value="ALL">Any draft status</option>
              <option value="pre_draft">Pre-draft</option>
              <option value="drafting">Drafting</option>
              <option value="complete">Drafted</option>
              <option value="none">No draft synced</option>
            </select>
            {(groupOptions.named.length > 0 || groupOptions.ungrouped > 0) && (
              <select
                className="select sm"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="ALL">All groups</option>
                {groupOptions.named.map(([name, count]) => (
                  <option key={name} value={name}>
                    {name} ({count})
                  </option>
                ))}
                {groupOptions.ungrouped > 0 && (
                  <option value={UNGROUPED}>Ungrouped ({groupOptions.ungrouped})</option>
                )}
              </select>
            )}
            <span style={{ flex: 1 }} />
            {(["name", "teams", "record", "draftTime", "status", "synced"] as SortKey[]).map((k) => (
              <button
                key={k}
                className={`sorth ${sortBy === k ? "on" : ""}`}
                onClick={() => toggleSort(k)}
              >
                {k === "name"
                  ? "Name"
                  : k === "teams"
                    ? "Teams"
                    : k === "record"
                      ? "Record"
                      : k === "draftTime"
                        ? "Draft"
                        : k === "status"
                          ? "Status"
                          : "Synced"}
                {sortBy === k && <span className="arrow">{sortDir === "asc" ? "↑" : "↓"}</span>}
              </button>
            ))}
          </div>

          <DataTable>
            <TableHeaderRow>
              <span style={{ flex: 1, marginLeft: 34 }}>League</span>
              <span style={{ minWidth: 110 }}>My team</span>
              <span style={{ minWidth: 76 }}>Status</span>
              <span style={{ minWidth: 100 }}>Draft time</span>
              <span style={{ minWidth: 50 }}>Teams</span>
              <span style={{ minWidth: 70 }}>Scoring</span>
              <span style={{ minWidth: 50 }}>Record</span>
              <span style={{ width: 16 }} />
            </TableHeaderRow>
            {sorted.map((lg) => {
              const draft = draftsByLeague[lg.id];
              const record = rosterByLeague.get(lg.id);
              const myTeamName = myTeamNameByLeague.get(lg.id);
              const scoring = scoringFormatLabel(lg.settings);
              return (
                <TableRow as="link" href={`/manager/${lg.id}`} key={lg.id}>
                  <LeagueAvatar league={lg} />
                  <span className="tname" style={{ flex: 1 }}>{lg.name}</span>
                  <span className="portmeta" style={{ minWidth: 110 }}>{myTeamName ?? "—"}</span>
                  <Badge tone={statusChipStyle(lg.status)}>{statusLabel(lg.status)}</Badge>
                  <span className="portmeta" style={{ minWidth: 100 }}>
                    {draft?.startTime ? (mounted ? formatUpcoming(draft.startTime) : "—") : "—"}
                  </span>
                  <span className="portmeta" style={{ minWidth: 50 }}>{lg.totalRosters}</span>
                  <span className="portmeta" style={{ minWidth: 70 }}>{scoring ?? "—"}</span>
                  <span className="portmeta" style={{ minWidth: 50 }}>
                    {record ? `${record.wins}-${record.losses}${record.ties > 0 ? `-${record.ties}` : ""}` : "—"}
                  </span>
                  <IconChevronRight width={16} height={16} style={{ color: "var(--dim)", flex: "none" }} />
                </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  padding: "32px 16px",
                  color: "var(--dim)",
                }}
              >
                <IconSearch width={22} height={22} />
                <span style={{ color: "var(--bone)", fontSize: 13, fontWeight: 600 }}>No leagues found</span>
                <span className="hint" style={{ margin: 0 }}>Try a different search or status filter.</span>
              </div>
            )}
          </DataTable>
          {sorted.length > 0 && (
            <div className="hint" style={{ marginTop: 8, display: "flex", justifyContent: "space-between" }}>
              <span>
                {sorted.length} league{sorted.length === 1 ? "" : "s"} shown
                {sorted.length !== leagues.length ? ` of ${leagues.length}` : ""}
              </span>
              <span>
                {sorted.reduce((sum, lg) => sum + lg.totalRosters, 0)} total teams
              </span>
            </div>
          )}
        </section>
      )}

      {rosters.length > 0 && (
        <section className="sec">
          <SectionHead title="My Portfolio" right="playoff outlook, league breakdown, and player exposure across everything" />

          <StatCardGrid variant="grid">
            <StatCard
              icon={IconFlag}
              color={TIER_COLOR.likely}
              label="Playoff Outlook"
              value={`${playoffOutlook.likely} likely in`}
              sub={`${playoffOutlook.bubble} bubble · ${playoffOutlook.outside} outside · ${playoffOutlook.longshot} longshot`}
            />
            <StatCard
              icon={IconCheck}
              color="var(--mint)"
              label="Record Snapshot"
              value={`${portfolio.winningLeagues} winning`}
              sub={`${portfolio.evenLeagues} .500 · ${portfolio.losingLeagues} losing`}
            />
            <StatCard
              icon={IconUsers}
              label="Positional Depth"
              value={
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                  {positionalDepth.map((d) => (
                    <Badge key={d.pos} tone={tierTone(DEPTH_COLOR[d.tier])}>
                      {d.pos} {d.tier}
                    </Badge>
                  ))}
                </span>
              }
            />
          </StatCardGrid>
          <p className="hint" style={{ marginTop: 8 }}>
            Playoff % is a real estimate from your current standing, roster strength, and how far
            into the season you are — not a full schedule simulation. Positional Depth compares
            your own positions against each other (real trade value), not the wider league.
          </p>

          <div style={{ marginTop: 20 }}>
            <SectionHead level={3} title="League Breakdown" style={{ marginBottom: 8 }} />
            <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
              <button
                className={`chip-filter ${breakdownTierFilter === "ALL" ? "on" : ""}`}
                onClick={() => setBreakdownTierFilter("ALL")}
              >
                All <span className="portmeta">{leagueBreakdownRows.length}</span>
              </button>
              {PLAYOFF_TIERS.map((t) => (
                <button
                  key={t.key}
                  className={`chip-filter ${breakdownTierFilter === t.key ? "on" : ""}`}
                  onClick={() => setBreakdownTierFilter(t.key)}
                >
                  {t.label} <span className="portmeta">{breakdownTierCounts[t.key]}</span>
                </button>
              ))}
            </div>
            <DataTable>
              <TableHeaderRow>
                <span style={{ flex: 1, marginLeft: 34 }}>League</span>
                <span style={{ minWidth: 55 }}>Record</span>
                <span style={{ minWidth: 55 }}>FC Rank</span>
                <span style={{ minWidth: 70 }}>Playoff %</span>
                <span style={{ minWidth: 70, textAlign: "right" }}>Points For</span>
                <span style={{ minWidth: 70, textAlign: "right" }}>Max PF</span>
                <span style={{ minWidth: 70 }}>Standing</span>
              </TableHeaderRow>
              {(showAllBreakdown ? filteredBreakdownRows : filteredBreakdownRows.slice(0, 10)).map((row) => (
                <TableRow as="link" href={`/manager/${row.league.id}`} key={row.league.id}>
                  <LeagueAvatar league={row.league} />
                  <span className="tname" style={{ flex: 1 }}>{row.league.name}</span>
                  <span className="portmeta" style={{ minWidth: 55 }}>
                    {row.roster.wins}-{row.roster.losses}{row.roster.ties > 0 ? `-${row.roster.ties}` : ""}
                  </span>
                  <span className="portmeta" style={{ minWidth: 55 }}>
                    {row.fcRank != null ? `#${row.fcRank}` : "—"}
                  </span>
                  <span style={{ minWidth: 70 }}>
                    {row.playoffPct != null ? (
                      <Badge tone={tierTone(TIER_COLOR[playoffTier(row.playoffPct).key])}>{row.playoffPct}%</Badge>
                    ) : (
                      "—"
                    )}
                  </span>
                  <span className="portvalue" style={{ minWidth: 70, textAlign: "right" }}>
                    {row.roster.fpts != null ? row.roster.fpts.toFixed(1) : "—"}
                  </span>
                  <span className="portmeta" style={{ minWidth: 70, textAlign: "right" }}>
                    {row.roster.maxPtsFor != null ? row.roster.maxPtsFor.toFixed(1) : "—"}
                  </span>
                  <span className="portmeta" style={{ minWidth: 70 }}>
                    {row.standing != null ? `#${row.standing} of ${row.totalTeams}` : "—"}
                  </span>
                </TableRow>
              ))}
            </DataTable>
            {filteredBreakdownRows.length > 10 && (
              <button
                className="linklike"
                style={{ marginTop: 8, fontSize: 13 }}
                onClick={() => setShowAllBreakdown((v) => !v)}
              >
                {showAllBreakdown ? "Show fewer" : `Show all ${filteredBreakdownRows.length} leagues`}
              </button>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            <SectionHead
              level={3}
              title="Player Exposure"
              right={
                <span style={{ display: "flex", gap: 4 }}>
                  <button
                    className={`chip-filter ${exposureView === "map" ? "on" : ""}`}
                    onClick={() => setExposureView("map")}
                  >
                    Map
                  </button>
                  <button
                    className={`chip-filter ${exposureView === "table" ? "on" : ""}`}
                    onClick={() => setExposureView("table")}
                  >
                    Table
                  </button>
                </span>
              }
              style={{ marginBottom: 8 }}
            />
            <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
              <button
                className={`chip-filter ${exposurePos === "ALL" ? "on" : ""}`}
                onClick={() => setExposurePos("ALL")}
              >
                All
              </button>
              {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
                <button
                  key={pos}
                  className={`chip-filter ${exposurePos === pos ? "on" : ""}`}
                  onClick={() => setExposurePos(pos)}
                  style={exposurePos === pos ? { color: posChipStyle(pos).color } : undefined}
                >
                  {pos}
                </button>
              ))}
              <span className="portmeta" style={{ marginLeft: 4 }}>Status</span>
              {(["ALL", "INJURED", "Questionable", "Doubtful", "Out", "IR"] as const).map((s) => (
                <button
                  key={s}
                  className={`chip-filter ${exposureStatus === s ? "on" : ""}`}
                  onClick={() => setExposureStatus(s)}
                >
                  {s === "ALL" ? "All" : s === "INJURED" ? "Injured" : s}{" "}
                  <span className="portmeta">
                    {s === "ALL"
                      ? exposure.rows.length
                      : s === "INJURED"
                        ? exposureStatusCounts.injured
                        : exposureStatusCounts[s] ?? 0}
                  </span>
                </button>
              ))}
              <select
                className="select sm"
                value={exposureLevel}
                onChange={(e) => setExposureLevel(e.target.value as typeof exposureLevel)}
              >
                <option value="ALL">Any exposure</option>
                <option value="LOW">Low (&lt;20%)</option>
                <option value="HIGH">High (40%+)</option>
                <option value="OVER">Over (60%+)</option>
              </select>
            </div>

            {exposureFiltered.length === 0 ? (
              <p className="hint">No players match these filters.</p>
            ) : exposureView === "table" ? (
              <DataTable>
                <TableHeaderRow>
                  <span style={{ flex: 1, marginLeft: 34 }}>Player</span>
                  <span style={{ minWidth: 60, textAlign: "right" }}>Value</span>
                  <span style={{ minWidth: 70, textAlign: "right" }}>Portfolio Value</span>
                  <span style={{ minWidth: 60, textAlign: "right" }}>Exposure</span>
                  <span style={{ minWidth: 60, textAlign: "right" }}>Leagues</span>
                </TableHeaderRow>
                {exposureFiltered.map((row) => (
                  <TableRow key={row.playerId}>
                    <PlayerAvatar playerId={row.playerId} pos={row.pos} size={26} />
                    <span className="tname" style={{ flex: 1 }}>{row.name}</span>
                    <span className="portmeta" style={{ minWidth: 60, textAlign: "right" }}>
                      {Math.round(row.fantisValue)}
                    </span>
                    <span className="portvalue" style={{ minWidth: 70, textAlign: "right" }}>
                      {Math.round(row.fantisValue * row.count)}
                    </span>
                    <span className="portmeta" style={{ minWidth: 60, textAlign: "right" }}>
                      {Math.round((row.count / (exposure.totalLeagues || 1)) * 100)}%
                    </span>
                    <span className="portmeta" style={{ minWidth: 60, textAlign: "right" }}>
                      {row.count}/{exposure.totalLeagues}
                    </span>
                  </TableRow>
                ))}
              </DataTable>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
                {(["QB", "RB", "WR", "TE"] as const)
                  .filter((pos) => exposurePos === "ALL" || exposurePos === pos)
                  .map((pos) => {
                    const rows = exposureFiltered.filter((r) => r.pos === pos);
                    if (rows.length === 0) return null;
                    return (
                      <div key={pos}>
                        <p className="mgrstatlabel" style={{ marginBottom: 8 }}>
                          <span className="pos" style={posChipStyle(pos)}>{pos}</span>{" "}
                          <span className="portmeta">{rows.length}</span>
                        </p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                          {rows.map((row) => {
                            const size = row.count >= 6 ? 56 : row.count >= 3 ? 46 : 36;
                            return (
                              <div
                                key={row.playerId}
                                title={`${row.name} — ${row.count} of ${exposure.totalLeagues} leagues`}
                                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 64 }}
                              >
                                <div style={{ position: "relative" }}>
                                  <PlayerAvatar playerId={row.playerId} pos={row.pos} size={size} />
                                  <span
                                    style={{
                                      position: "absolute",
                                      bottom: -4,
                                      right: -4,
                                      background: "var(--amber)",
                                      color: "var(--ink)",
                                      borderRadius: 999,
                                      fontSize: 10,
                                      fontWeight: 700,
                                      padding: "1px 5px",
                                      lineHeight: 1.4,
                                    }}
                                  >
                                    {row.count}
                                  </span>
                                </div>
                                <span
                                  className="portmeta"
                                  style={{ fontSize: 11, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}
                                >
                                  {row.name}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
