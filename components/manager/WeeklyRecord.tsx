"use client";

import { useMemo, useState } from "react";
import { computeStreak } from "@/lib/leagueRank";
import { IconArrowDown, IconArrowUp, IconCheck, IconShield } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";

export interface WeeklyRecordWeek {
  week: number;
  points: number;
  won: boolean | null; // null covers BOTH a real tie and a bye/unresolved pairing — Sleeper's own data
  // doesn't distinguish them (see prisma/schema.prisma's WeeklyResult comment), so this app never guesses either.
  opponentTeamName: string | null;
  opponentPoints: number | null;
}
export interface WeeklyRecordLeague {
  leagueId: string;
  leagueName: string;
  group: string | null;
  bestBall: boolean;
  weeks: WeeklyRecordWeek[]; // sorted ascending by week; only weeks with a real synced result
}

type Filter = "all" | "winning" | "even" | "losing";

const dot = (color: string) => ({
  width: 16,
  height: 16,
  borderRadius: 4,
  background: color,
  flex: "none",
} as const);

const WEEK_COLOR = {
  win: "var(--mint)",
  loss: "var(--red)",
  pending: "color-mix(in srgb, var(--muted) 40%, transparent)",
};

export default function WeeklyRecord({ leagues }: { leagues: WeeklyRecordLeague[] }) {
  const [hideBestBall, setHideBestBall] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const l of leagues) if (l.group && l.group.trim()) set.add(l.group.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [leagues]);

  const bestBallCount = leagues.filter((l) => l.bestBall).length;
  const scoped = leagues.filter(
    (l) => (!hideBestBall || !l.bestBall) && (!groupFilter || l.group?.trim() === groupFilter)
  );

  const withRecord = useMemo(
    () =>
      scoped.map((l) => {
        const wins = l.weeks.filter((w) => w.won === true).length;
        const losses = l.weeks.filter((w) => w.won === false).length;
        const undecided = l.weeks.filter((w) => w.won === null).length; // tie or bye — see field comment
        const played = wins + losses;
        return { ...l, wins, losses, undecided, winPct: played > 0 ? wins / played : null, streak: computeStreak(l.weeks) };
      }),
    [scoped]
  );

  const winningCount = withRecord.filter((l) => l.wins > l.losses).length;
  const evenCount = withRecord.filter((l) => l.wins === l.losses && (l.wins > 0 || l.losses > 0)).length;
  const losingCount = withRecord.filter((l) => l.wins < l.losses).length;

  const maxWeek = withRecord.reduce((m, l) => Math.max(m, ...l.weeks.map((w) => w.week), 0), 0);

  // By-week trend: across every scoped league, how many wins/losses that week —
  // the direct answer to "how many leagues am I winning/losing", over time.
  const byWeek = useMemo(() => {
    const rows: { week: number; won: number; lost: number; undecided: number }[] = [];
    for (let w = maxWeek; w >= 1; w--) {
      let won = 0, lost = 0, undecided = 0;
      for (const l of withRecord) {
        const entry = l.weeks.find((wk) => wk.week === w);
        if (!entry) continue;
        if (entry.won === true) won++;
        else if (entry.won === false) lost++;
        else undecided++;
      }
      if (won + lost + undecided > 0) rows.push({ week: w, won, lost, undecided });
    }
    return rows;
  }, [withRecord, maxWeek]);

  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: withRecord.length },
    { key: "winning", label: "Winning", count: winningCount },
    { key: "even", label: ".500", count: evenCount },
    { key: "losing", label: "Losing", count: losingCount },
  ];
  const filtered = withRecord
    .filter((l) => (filter === "all" ? true : filter === "winning" ? l.wins > l.losses : filter === "losing" ? l.wins < l.losses : l.wins === l.losses && (l.wins > 0 || l.losses > 0)))
    // worst record first by default — surfaces the leagues that need a look
    .sort((a, b) => (a.winPct ?? 0.5) - (b.winPct ?? 0.5) || a.leagueName.localeCompare(b.leagueName));

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          description={
            <>
              Your real per-week result (win/loss/tie) in every league, from Sleeper&rsquo;s own
              resolved matchup data — never a guess.
            </>
          }
        />
        <StatCardGrid variant="hero">
          <StatCard icon={IconArrowUp} color="var(--mint)" label="Winning leagues" value={winningCount} valueColor="var(--mint)" sub={`of ${withRecord.length}`} />
          <StatCard icon={IconCheck} color="var(--muted)" label=".500 leagues" value={evenCount} />
          <StatCard icon={IconArrowDown} color="var(--red)" label="Losing leagues" value={losingCount} valueColor={losingCount > 0 ? "var(--red)" : undefined} />
          <StatCard icon={IconShield} color="var(--bone)" label="Weeks tracked" value={maxWeek} />
        </StatCardGrid>
      </section>

      {byWeek.length > 0 && (
        <section className="sec">
          <SectionHead title="By week" right="most recent first" />
          <DataTable>
            <TableHeaderRow>
              <span style={{ minWidth: 60 }}>Week</span>
              <span style={{ flex: 1 }}>Won</span>
              <span style={{ flex: 1 }}>Lost</span>
              <span style={{ flex: 1 }}>Tied / bye</span>
              <span style={{ minWidth: 70, textAlign: "right" }}>Win %</span>
            </TableHeaderRow>
            {byWeek.map((r) => {
              const decided = r.won + r.lost;
              const pct = decided > 0 ? Math.round((r.won / decided) * 100) : null;
              return (
                <TableRow key={r.week}>
                  <span className="tname" style={{ minWidth: 60 }}>Week {r.week}</span>
                  <span className="portmeta" style={{ flex: 1, color: "var(--mint)" }}>{r.won}</span>
                  <span className="portmeta" style={{ flex: 1, color: r.lost > 0 ? "var(--red)" : undefined }}>{r.lost}</span>
                  <span className="portmeta" style={{ flex: 1 }}>{r.undecided}</span>
                  <span className="portmeta" style={{ minWidth: 70, textAlign: "right", fontWeight: 600 }}>{pct == null ? "—" : `${pct}%`}</span>
                </TableRow>
              );
            })}
          </DataTable>
        </section>
      )}

      <section className="sec">
        <SectionHead title="By league" right={`${filtered.length} of ${withRecord.length}`} />
        {groups.length > 0 && (
          <div className="field" style={{ marginBottom: 8, gap: 8 }}>
            <button className={`chip-filter ${groupFilter === null ? "on" : ""}`} onClick={() => setGroupFilter(null)}>
              All leagues
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
        <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`chip-filter ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label} ({f.count})
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {bestBallCount > 0 && (
            <button
              className={`chip-filter ${hideBestBall ? "on" : ""}`}
              onClick={() => setHideBestBall((v) => !v)}
              title="Best ball leagues set their own lineups"
            >
              {hideBestBall ? `Best ball hidden (${bestBallCount})` : `Hide ${bestBallCount} best ball`}
            </button>
          )}
        </div>

        {withRecord.length === 0 ? (
          <p className="hint">No synced weekly results yet.</p>
        ) : filtered.length === 0 ? (
          <p className="hint">No leagues match this filter.</p>
        ) : (
          <DataTable>
            {filtered.map((l) => (
              <TableRow as="link" href={`/manager/${l.leagueId}`} key={l.leagueId}>
                <span className="tname" style={{ flex: "1 1 220px", minWidth: 0 }}>{l.leagueName}</span>
                <span className="portmeta" style={{ minWidth: 60 }}>
                  {l.wins}-{l.losses}{l.undecided > 0 ? `-${l.undecided}` : ""}
                </span>
                {l.streak && (
                  <span className="portmeta" style={{ minWidth: 30, color: l.streak.startsWith("W") ? "var(--mint)" : "var(--red)" }}>
                    {l.streak}
                  </span>
                )}
                <span style={{ display: "flex", gap: 3, flexWrap: "wrap", flex: "1 1 auto", justifyContent: "flex-end" }}>
                  {Array.from({ length: maxWeek }, (_, i) => i + 1).map((w) => {
                    const entry = l.weeks.find((wk) => wk.week === w);
                    if (!entry) return <span key={w} style={dot("transparent")} />;
                    const color = entry.won === true ? WEEK_COLOR.win : entry.won === false ? WEEK_COLOR.loss : WEEK_COLOR.pending;
                    const title = `Week ${w}${entry.opponentTeamName ? ` vs ${entry.opponentTeamName}` : ""}: ${entry.points.toFixed(1)}${
                      entry.opponentPoints != null ? `–${entry.opponentPoints.toFixed(1)}` : ""
                    }`;
                    return <span key={w} style={dot(color)} title={title} />;
                  })}
                </span>
              </TableRow>
            ))}
          </DataTable>
        )}
      </section>
    </>
  );
}
