"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addAll, filterState, prune, removeAll, selectionCounts, toggle as toggleSel, useLeagueSelection, writeSelection } from "@/lib/leagueSelection";
import { statusChipStyle, statusLabel } from "@/lib/manager";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import { computeLeagueRank, type LeagueRosterRow } from "@/lib/leagueRank";
import { useLeagueFavorites } from "@/lib/leagueFavorites";
import { IconSearch, IconStar } from "./MgrIcons";
import { PageHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";

export interface MyTeamRow {
  leagueId: string;
  leagueName: string;
  status: string;
  group: string | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  myPoints: number | null;
  opponentTeamName: string | null;
  opponentPoints: number | null;
  week: number | null;
  alertCount: number;
  waiverPosition: number | null;
  faabUsed: number | null;
  rosterId: number | null;
  leagueRosters: LeagueRosterRow[];
  lastSyncedAt: string | null;
  bestBall: boolean;
}

type StatusFilter = "all" | "active" | "attention" | "bestball" | "stale" | "other";
const PAGE = 60;
const STALE_MS = 24 * 3600_000;

function syncAge(iso: string | null, now: number): { text: string; stale: boolean } {
  if (!iso) return { text: "never synced", stale: true };
  const ms = now - new Date(iso).getTime();
  const h = Math.floor(ms / 3600_000);
  const text = h < 1 ? "synced <1h ago" : h < 48 ? `synced ${h}h ago` : `synced ${Math.floor(h / 24)}d ago`;
  return { text, stale: ms > STALE_MS };
}

type SortKey = "name" | "record" | "week" | "alerts" | "rank";
type SortDir = "asc" | "desc";

function winPct(t: MyTeamRow): number {
  const g = (t.wins ?? 0) + (t.losses ?? 0) + (t.ties ?? 0);
  return g === 0 ? -1 : ((t.wins ?? 0) + (t.ties ?? 0) * 0.5) / g;
}

export default function MyTeams({ teams }: { teams: MyTeamRow[] }) {
  // Search, filters and sort live in the URL, so opening a league and pressing Back returns to exactly this view.
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [query, setQuery] = useState(sp.get("q") ?? "");
  const [sortBy, setSortBy] = useState<SortKey>((sp.get("sort") as SortKey) || "alerts");
  const [sortDir, setSortDir] = useState<SortDir>(sp.get("dir") === "asc" ? "asc" : "desc");
  const [groupFilter, setGroupFilter] = useState<string | null>(sp.get("group"));
  const [pinnedOnly, setPinnedOnly] = useState(sp.get("pinned") === "1");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>((sp.get("show") as StatusFilter) || "all");
  const [selOnly, setSelOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (sortBy !== "alerts") p.set("sort", sortBy);
    if (sortDir !== "desc") p.set("dir", sortDir);
    if (groupFilter) p.set("group", groupFilter);
    if (pinnedOnly) p.set("pinned", "1");
    if (statusFilter !== "all") p.set("show", statusFilter);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [query, sortBy, sortDir, groupFilter, pinnedOnly, statusFilter, router, pathname]);

  // Selection (lib/leagueSelection.ts): independent of the filter, kept across pages and reloads.
  const storedSel = useLeagueSelection();
  const selection = useMemo(() => prune(storedSel, teams.map((t) => t.leagueId)), [storedSel, teams]);
  const [now] = useState(() => Date.now());
  const { favorites, isFavorite, toggle: toggleFavorite } = useLeagueFavorites();

  // Real, owner-set labels (League Info tab) — already collected per
  // league but never used as a filter anywhere until now. Sorted for a
  // stable chip order; a league with no group set is simply left out of
  // every group's count/filter (it still shows under "All").
  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) {
      if (t.group && t.group.trim()) set.add(t.group.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [teams]);

  // Real league-wide rank per team, from every roster in that league
  // (LeagueRoster — zero extra Sleeper calls) and the same season
  // projection data Trade/Waiver already use. Computed per league since
  // rank only makes sense within a league, never portfolio-wide.
  const seasonTotals = useSeasonTotals();
  const rankByLeague = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeLeagueRank>>();
    for (const t of teams) {
      if (t.rosterId == null) continue;
      map.set(t.leagueId, computeLeagueRank(t.leagueRosters, t.rosterId, seasonTotals));
    }
    return map;
  }, [teams, seasonTotals]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(key === "name" || key === "rank" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams.filter(
      (t) =>
        (!q || t.leagueName.toLowerCase().includes(q)) &&
        (!groupFilter || t.group?.trim() === groupFilter) &&
        (!pinnedOnly || favorites.has(t.leagueId)) &&
        (!selOnly || selection.has(t.leagueId)) &&
        (statusFilter === "all" ||
          (statusFilter === "active" && t.status === "in_season" && !t.bestBall) ||
          (statusFilter === "attention" && t.alertCount > 0) ||
          (statusFilter === "bestball" && t.bestBall) ||
          (statusFilter === "stale" && t.status === "in_season" && syncAge(t.lastSyncedAt, now).stale) ||
          (statusFilter === "other" && t.status !== "in_season"))
    );
  }, [teams, query, groupFilter, pinnedOnly, favorites, statusFilter, selOnly, selection, now]);
  const filteredIds = useMemo(() => filtered.map((t) => t.leagueId), [filtered]);
  const headState = filterState(selection, filteredIds);
  const counts = selectionCounts(selection, filteredIds);
  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: teams.length, active: 0, attention: 0, bestball: 0, stale: 0, other: 0 };
    for (const t of teams) {
      if (t.status === "in_season" && !t.bestBall) c.active++;
      if (t.alertCount > 0) c.attention++;
      if (t.bestBall) c.bestball++;
      if (t.status === "in_season" && syncAge(t.lastSyncedAt, now).stale) c.stale++;
      if (t.status !== "in_season") c.other++;
    }
    return c;
  }, [teams, now]);
  const scoped = (path: string) => `${path}${path.includes("?") ? "&" : "?"}scope=selection`;

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const rows = [...filtered];
    rows.sort((a, b) => {
      // Favorites always lead, regardless of which column is sorted —
      // that's the whole point of pinning a handful of leagues out of
      // 200+. Within the favorite/non-favorite groups, the chosen sort
      // still applies normally.
      const favDiff = Number(favorites.has(b.leagueId)) - Number(favorites.has(a.leagueId));
      if (favDiff !== 0) return favDiff;
      switch (sortBy) {
        case "name":
          return a.leagueName.localeCompare(b.leagueName) * dir;
        case "record":
          return (winPct(a) - winPct(b)) * dir;
        case "week":
          return ((a.myPoints ?? -1) - (b.myPoints ?? -1)) * dir;
        case "alerts":
          return (a.alertCount - b.alertCount) * dir;
        case "rank": {
          // Lower rank number = better team; unranked (no season data yet
          // or no roster) sorts to the bottom regardless of direction.
          const ar = rankByLeague.get(a.leagueId)?.rank;
          const br = rankByLeague.get(b.leagueId)?.rank;
          if (ar == null && br == null) return 0;
          if (ar == null) return 1;
          if (br == null) return -1;
          return (ar - br) * dir;
        }
        default:
          return 0;
      }
    });
    return rows;
  }, [filtered, sortBy, sortDir, rankByLeague, favorites]);

  const totals = useMemo(() => {
    let wins = 0, losses = 0, ties = 0, needAttention = 0, inSeason = 0, topHalf = 0, ranked = 0;
    for (const t of teams) {
      wins += t.wins ?? 0;
      losses += t.losses ?? 0;
      ties += t.ties ?? 0;
      if (t.alertCount > 0) needAttention += 1;
      if (t.status === "in_season") inSeason += 1;
      const rank = rankByLeague.get(t.leagueId);
      if (rank?.rank != null) {
        ranked += 1;
        if (rank.rank <= rank.totalTeams / 2) topHalf += 1;
      }
    }
    return { wins, losses, ties, needAttention, inSeason, topHalf, ranked };
  }, [teams, rankByLeague]);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          description={
            <>
              Every league&rsquo;s roster in one table — record, this week&rsquo;s matchup, and
              how many real alerts are open — instead of clicking into each one.
            </>
          }
        />
        <StatCardGrid variant="grid">
          <StatCard
            label="Combined record"
            value={`${totals.wins}-${totals.losses}${totals.ties > 0 ? `-${totals.ties}` : ""}`}
          />
          <StatCard label="In season" value={totals.inSeason} />
          <StatCard
            label="Teams need attention"
            value={totals.needAttention}
            valueColor={totals.needAttention > 0 ? "var(--red)" : "var(--mint)"}
          />
          <StatCard
            label="Top-half leagues"
            value={
              <>
                {totals.topHalf}
                {totals.ranked > 0 && (
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)", marginLeft: 6 }}>
                    of {totals.ranked} ranked
                  </span>
                )}
              </>
            }
          />
        </StatCardGrid>
      </section>

      <section className="sec">
        <div className="field" style={{ marginBottom: 8, alignItems: "center" }}>
          <input
            className="input"
            placeholder="Search leagues…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            style={{ maxWidth: 280 }}
          />
        </div>
        <div className="field" style={{ marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
          {(
            [
              ["all", "All"],
              ["active", "Active"],
              ["attention", "Needs attention"],
              ["stale", "Sync stale"],
              ["bestball", "Best ball"],
              ["other", "Not in season"],
            ] as [StatusFilter, string][]
          ).map(([k, label]) =>
            k !== "all" && statusCounts[k] === 0 ? null : (
              <button
                key={k}
                className={`chip-filter ${statusFilter === k ? "on" : ""}`}
                onClick={() => {
                  setStatusFilter(k);
                  setLimit(PAGE);
                }}
              >
                {label} ({statusCounts[k]})
              </button>
            )
          )}
          {selection.size > 0 && (
            <button className={`chip-filter ${selOnly ? "on" : ""}`} onClick={() => setSelOnly((v) => !v)}>
              Selected only ({selection.size})
            </button>
          )}
        </div>
        {selection.size > 0 && (
          <div className="lmselbar">
            <span>
              <b>{counts.total}</b> selected{counts.hidden > 0 ? ` (${counts.hidden} hidden by the filter)` : ""}
            </span>
            <Link className="btn sm" href={scoped("/manager/lineups")}>Lineups for these</Link>
            <Link className="btn ghost sm" href={scoped("/manager/waiver")}>Waivers for these</Link>
            <Link className="btn ghost sm" href={scoped("/manager/open-spots")}>Empty spots for these</Link>
            <button type="button" className="linklike" onClick={() => writeSelection([])}>Clear selection</button>
          </div>
        )}
        {favorites.size > 0 && (
          <div className="field" style={{ marginBottom: 8, gap: 8 }}>
            <button
              className={`chip-filter ${pinnedOnly ? "on" : ""}`}
              onClick={() => setPinnedOnly((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <IconStar width={13} height={13} fill="currentColor" />
              Pinned ({favorites.size})
            </button>
          </div>
        )}
        {groups.length > 0 && (
          <div className="field" style={{ marginBottom: 8, gap: 8 }}>
            <button className={`chip-filter ${groupFilter === null ? "on" : ""}`} onClick={() => setGroupFilter(null)}>
              All
            </button>
            {groups.map((g) => (
              <button
                key={g}
                className={`chip-filter ${groupFilter === g ? "on" : ""}`}
                onClick={() => setGroupFilter((cur) => (cur === g ? null : g))}
              >
                {g}
              </button>
            ))}
          </div>
        )}
        <div
          className="field"
          style={{ marginBottom: 0, gap: 12, position: "sticky", top: 0, zIndex: 1, background: "var(--ink)", padding: "8px 0" }}
        >
          <input
            type="checkbox"
            aria-label={headState === "all" ? "Deselect every filtered league" : `Select all ${filteredIds.length} filtered leagues`}
            title={headState === "all" ? "Deselect every filtered league" : `Select all ${filteredIds.length} filtered leagues (not just the ones shown)`}
            checked={headState === "all"}
            ref={(el) => {
              if (el) el.indeterminate = headState === "some";
            }}
            onChange={() => writeSelection(headState === "all" ? removeAll(selection, filteredIds) : addAll(selection, filteredIds))}
          />
          {(["name", "record", "rank", "week", "alerts"] as SortKey[]).map((k) => (
            <button key={k} className={`sorth ${sortBy === k ? "on" : ""}`} onClick={() => toggleSort(k)}>
              {k === "name"
                ? "League"
                : k === "record"
                  ? "Record"
                  : k === "rank"
                    ? "Rank"
                    : k === "week"
                      ? "This week"
                      : "Alerts"}
              {sortBy === k && <span className="arrow">{sortDir === "asc" ? "↑" : "↓"}</span>}
            </button>
          ))}
        </div>

        <DataTable>
          {sorted.slice(0, limit).map((t) => {
            const hasRecord = t.wins != null;
            const age = syncAge(t.lastSyncedAt, now);
            const isSel = selection.has(t.leagueId);
            const hasMatchup = t.myPoints != null;
            const rank = rankByLeague.get(t.leagueId);
            return (
              <TableRow as="link" href={`/manager/${t.leagueId}`} key={t.leagueId} highlight={isSel}>
                <input
                  type="checkbox"
                  aria-label={`Select ${t.leagueName}`}
                  checked={isSel}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => writeSelection(toggleSel(selection, t.leagueId))}
                  style={{ flex: "none" }}
                />
                <button
                  type="button"
                  aria-label={isFavorite(t.leagueId) ? "Unpin league" : "Pin league to the top"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFavorite(t.leagueId);
                  }}
                  style={{ background: "none", border: 0, padding: 0, cursor: "pointer", display: "flex", flex: "none", color: isFavorite(t.leagueId) ? "var(--amber)" : "var(--dim)" }}
                >
                  <IconStar width={16} height={16} fill={isFavorite(t.leagueId) ? "currentColor" : "none"} />
                </button>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="tname" style={{ display: "block" }}>{t.leagueName}</span>
                  <span className="portmeta" style={{ display: "block", fontWeight: 400, color: age.stale && t.status === "in_season" ? "var(--red)" : undefined }}>
                    {age.text}
                    {t.bestBall ? " · best ball" : ""}
                  </span>
                </span>
                <span className="portmeta" style={{ minWidth: 60 }}>
                  {hasRecord ? `${t.wins}-${t.losses}${(t.ties ?? 0) > 0 ? `-${t.ties}` : ""}` : "—"}
                </span>
                <span className="portmeta" style={{ minWidth: 60 }}>
                  {rank?.rank != null ? `#${rank.rank} of ${rank.totalTeams}` : "—"}
                </span>
                <span className="portmeta" style={{ minWidth: 70 }}>
                  {t.waiverPosition != null ? `waiver #${t.waiverPosition}` : ""}
                  {t.faabUsed != null ? `${t.waiverPosition != null ? " · " : ""}$${t.faabUsed} used` : ""}
                </span>
                <span className="portmeta" style={{ minWidth: 130, textAlign: "right" }}>
                  {hasMatchup
                    ? `${t.myPoints!.toFixed(1)} vs ${t.opponentPoints != null ? t.opponentPoints.toFixed(1) : "—"}${t.opponentTeamName ? ` (${t.opponentTeamName})` : ""}`
                    : "—"}
                </span>
                <span className="pos" style={statusChipStyle(t.status)}>
                  {statusLabel(t.status)}
                </span>
                {t.alertCount > 0 ? (
                  <span className="pos" style={{ color: "var(--red)", background: "color-mix(in srgb, var(--red) 20%, transparent)", borderColor: "color-mix(in srgb, var(--red) 52%, transparent)" }}>
                    {t.alertCount} alert{t.alertCount === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="portmeta" style={{ color: "var(--mint)" }}>clear</span>
                )}
              </TableRow>
            );
          })}
          {sorted.length === 0 && teams.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "32px 16px", color: "var(--dim)" }}>
              <IconSearch width={22} height={22} />
              <span style={{ color: "var(--bone)", fontSize: 13, fontWeight: 600 }}>No teams yet</span>
              <span className="hint" style={{ margin: 0 }}>
                Connect a Sleeper username on the{" "}
                <Link href="/manager" className="link">Command Center</Link> to sync its real
                leagues in.
              </span>
            </div>
          )}
          {sorted.length === 0 && teams.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "32px 16px", color: "var(--dim)" }}>
              <IconSearch width={22} height={22} />
              <span style={{ color: "var(--bone)", fontSize: 13, fontWeight: 600 }}>No leagues found</span>
              <span className="hint" style={{ margin: 0 }}>Try a different search.</span>
            </div>
          )}
        </DataTable>
        {sorted.length > 0 && (
          <div className="hint" style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
            <span>
              {Math.min(limit, sorted.length)} of {sorted.length} league{sorted.length === 1 ? "" : "s"} shown
              {sorted.length !== teams.length ? ` (${teams.length} total)` : ""}
            </span>
            {sorted.length > limit && (
              <>
                <button type="button" className="linklike" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, sorted.length - limit)} more</button>
                <button type="button" className="linklike" onClick={() => setLimit(sorted.length)}>Show all</button>
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}
