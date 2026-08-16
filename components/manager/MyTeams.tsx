"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { statusChipStyle, statusLabel } from "@/lib/manager";
import { IconSearch } from "./MgrIcons";

export interface MyTeamRow {
  leagueId: string;
  leagueName: string;
  status: string;
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
}

type SortKey = "name" | "record" | "week" | "alerts";
type SortDir = "asc" | "desc";

function winPct(t: MyTeamRow): number {
  const g = (t.wins ?? 0) + (t.losses ?? 0) + (t.ties ?? 0);
  return g === 0 ? -1 : ((t.wins ?? 0) + (t.ties ?? 0) * 0.5) / g;
}

export default function MyTeams({ teams }: { teams: MyTeamRow[] }) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("alerts");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => t.leagueName.toLowerCase().includes(q));
  }, [teams, query]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const rows = [...filtered];
    rows.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.leagueName.localeCompare(b.leagueName) * dir;
        case "record":
          return (winPct(a) - winPct(b)) * dir;
        case "week":
          return ((a.myPoints ?? -1) - (b.myPoints ?? -1)) * dir;
        case "alerts":
          return (a.alertCount - b.alertCount) * dir;
        default:
          return 0;
      }
    });
    return rows;
  }, [filtered, sortBy, sortDir]);

  const totals = useMemo(() => {
    let wins = 0, losses = 0, ties = 0, needAttention = 0, inSeason = 0;
    for (const t of teams) {
      wins += t.wins ?? 0;
      losses += t.losses ?? 0;
      ties += t.ties ?? 0;
      if (t.alertCount > 0) needAttention += 1;
      if (t.status === "in_season") inSeason += 1;
    }
    return { wins, losses, ties, needAttention, inSeason };
  }, [teams]);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>My Teams</h1>
          <p>
            Every league&rsquo;s roster in one table — record, this week&rsquo;s matchup, and how
            many real alerts are open — instead of clicking into each one.
          </p>
        </div>
        <div className="mgrstats">
          <div className="mgrstat">
            <div className="mgrstatbody">
              <p className="mgrstatlabel">Combined record</p>
              <p className="mgrstatvalue">
                {totals.wins}-{totals.losses}
                {totals.ties > 0 ? `-${totals.ties}` : ""}
              </p>
            </div>
          </div>
          <div className="mgrstat">
            <div className="mgrstatbody">
              <p className="mgrstatlabel">In season</p>
              <p className="mgrstatvalue">{totals.inSeason}</p>
            </div>
          </div>
          <div className="mgrstat">
            <div className="mgrstatbody">
              <p className="mgrstatlabel">Teams need attention</p>
              <p className="mgrstatvalue" style={{ color: totals.needAttention > 0 ? "var(--red)" : "var(--mint)" }}>
                {totals.needAttention}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="field" style={{ marginBottom: 8, alignItems: "center" }}>
          <input
            className="input"
            placeholder="Search leagues…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 280 }}
          />
        </div>
        <div
          className="field"
          style={{ marginBottom: 0, gap: 12, position: "sticky", top: 0, zIndex: 1, background: "var(--ink)", padding: "8px 0" }}
        >
          {(["name", "record", "week", "alerts"] as SortKey[]).map((k) => (
            <button key={k} className={`sorth ${sortBy === k ? "on" : ""}`} onClick={() => toggleSort(k)}>
              {k === "name" ? "League" : k === "record" ? "Record" : k === "week" ? "This week" : "Alerts"}
              {sortBy === k && <span className="arrow">{sortDir === "asc" ? "↑" : "↓"}</span>}
            </button>
          ))}
        </div>

        <div className="mgrtable">
          {sorted.map((t) => {
            const hasRecord = t.wins != null;
            const hasMatchup = t.myPoints != null;
            return (
              <Link href={`/manager/${t.leagueId}`} className="mgrrow" key={t.leagueId}>
                <span className="tname" style={{ flex: 1 }}>{t.leagueName}</span>
                <span className="portmeta" style={{ minWidth: 60 }}>
                  {hasRecord ? `${t.wins}-${t.losses}${(t.ties ?? 0) > 0 ? `-${t.ties}` : ""}` : "—"}
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
              </Link>
            );
          })}
          {sorted.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "32px 16px", color: "var(--dim)" }}>
              <IconSearch width={22} height={22} />
              <span style={{ color: "var(--bone)", fontSize: 13, fontWeight: 600 }}>No leagues found</span>
              <span className="hint" style={{ margin: 0 }}>Try a different search.</span>
            </div>
          )}
        </div>
        {sorted.length > 0 && (
          <div className="hint" style={{ marginTop: 8 }}>
            {sorted.length} league{sorted.length === 1 ? "" : "s"} shown
            {sorted.length !== teams.length ? ` of ${teams.length}` : ""}
          </div>
        )}
      </section>
    </>
  );
}
