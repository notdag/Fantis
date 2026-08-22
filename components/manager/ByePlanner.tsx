"use client";

import { useEffect, useMemo, useState } from "react";
import { getState, currentProjectionWeek } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { BYE_WEEKS_2026 } from "@/lib/byeWeeks";
import { PlayerAvatar } from "./Avatar";
import { IconCalendar, IconFlag, IconUsers } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableRowSkeleton } from "./DataRow";

export interface ByeLeagueRow {
  leagueId: string;
  leagueName: string;
  players: string[];
}

export default function ByePlanner({ leagues }: { leagues: ByeLeagueRow[] }) {
  const { pmap, loading: pmapLoading, error: pmapError, retry: retryPmap } = usePlayerMap();
  const [currentWeek, setCurrentWeek] = useState<number | null>(null);
  const [stateError, setStateError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getState()
      .then((s) => {
        if (!cancelled) setCurrentWeek(currentProjectionWeek(s));
      })
      .catch(() => {
        if (!cancelled) setStateError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Group: week -> league -> players on bye that week (any rostered
  // player, not just starters — knowing a bench bye is coming still helps
  // you plan a waiver pickup ahead of time).
  const byWeek = useMemo(() => {
    if (!pmap || currentWeek == null) return new Map<number, { leagueId: string; leagueName: string; playerId: string }[]>();
    const map = new Map<number, { leagueId: string; leagueName: string; playerId: string }[]>();
    for (const lg of leagues) {
      for (const playerId of lg.players) {
        const entry = pmap[playerId];
        if (!entry) continue;
        const week = BYE_WEEKS_2026[entry.t];
        if (week == null || week < currentWeek) continue;
        const list = map.get(week) ?? [];
        list.push({ leagueId: lg.leagueId, leagueName: lg.leagueName, playerId });
        map.set(week, list);
      }
    }
    return map;
  }, [leagues, pmap, currentWeek]);

  const weeks = Array.from(byWeek.keys()).sort((a, b) => a - b);
  const loading = (pmapLoading || (currentWeek == null && !stateError)) && !pmapError;
  const thisWeekCount = currentWeek != null ? (byWeek.get(currentWeek)?.length ?? 0) : 0;
  const totalUpcoming = weeks.reduce((sum, w) => sum + (byWeek.get(w)?.length ?? 0), 0);
  const nextWeek = weeks[0];
  const nextWeekCount = nextWeek != null ? (byWeek.get(nextWeek)?.length ?? 0) : 0;

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          title="Bye Week Planner"
          description={
            <>
              Every rostered player&rsquo;s upcoming bye, across every in-season league — bench
              players included, so you can plan a waiver pickup before it&rsquo;s a scramble.
            </>
          }
        />
        {!loading && !pmapError && !(stateError && currentWeek == null) && (
          <StatCardGrid variant="hero">
            <StatCard
              icon={IconCalendar}
              color={thisWeekCount > 0 ? "var(--amber)" : "var(--mint)"}
              label="On bye this week"
              value={thisWeekCount}
              valueColor={thisWeekCount > 0 ? "var(--amber)" : undefined}
            />
            <StatCard
              icon={IconUsers}
              color="var(--muted)"
              label="Upcoming this season"
              value={totalUpcoming}
              sub={`across ${weeks.length} week${weeks.length === 1 ? "" : "s"} ahead`}
            />
            <StatCard
              icon={IconFlag}
              color="var(--amber)"
              label="Next bye week"
              value={nextWeek != null ? `Week ${nextWeek}` : "—"}
              sub={nextWeek != null ? `${nextWeekCount} player${nextWeekCount === 1 ? "" : "s"}` : undefined}
            />
          </StatCardGrid>
        )}
      </section>

      {pmapError ? (
        <section className="sec">
          <p className="hint">
            Couldn&rsquo;t load player data.{" "}
            <button type="button" className="link" onClick={retryPmap}>
              Retry
            </button>
          </p>
        </section>
      ) : stateError && currentWeek == null ? (
        <section className="sec">
          <p className="hint">Couldn&rsquo;t load the current NFL week — bye planning needs it to know what&rsquo;s still upcoming.</p>
        </section>
      ) : loading ? (
        <section className="sec">
          <DataTable>
            <TableRowSkeleton count={4} />
          </DataTable>
        </section>
      ) : weeks.length === 0 ? (
        <section className="sec">
          <p className="hint">No upcoming byes for anyone currently rostered.</p>
        </section>
      ) : (
        weeks.map((week) => {
          const rows = byWeek.get(week)!;
          return (
            <section className="sec" key={week}>
              <SectionHead
                title={`Week ${week}`}
                right={`${rows.length} player${rows.length === 1 ? "" : "s"} on bye${week === currentWeek ? " · this week" : ""}`}
              />
              <DataTable>
                {rows.map((r, i) => {
                  const entry = pmap![r.playerId];
                  return (
                    <TableRow as="link" href={`/manager/${r.leagueId}`} key={`${r.leagueId}-${r.playerId}-${i}`}>
                      <PlayerAvatar playerId={r.playerId} pos={entry.p} size={26} />
                      <span className="mgrplayername">{entry.n}</span>
                      {entry.p && (
                        <span className="pos" style={posChipStyle(entry.p)}>
                          {entry.p}
                        </span>
                      )}
                      <span className="tname" style={{ flex: 1 }}>{r.leagueName}</span>
                    </TableRow>
                  );
                })}
              </DataTable>
            </section>
          );
        })
      )}
    </>
  );
}
