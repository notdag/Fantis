"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getPlayers, getState, currentProjectionWeek, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { BYE_WEEKS_2026 } from "@/lib/byeWeeks";
import type { PlayerMap } from "@/lib/types";

export interface ByeLeagueRow {
  leagueId: string;
  leagueName: string;
  players: string[];
}

function Avatar({ playerId, pos, size }: { playerId: string; pos?: string; size: number }) {
  const ring = pos ? posChipStyle(pos).color : "var(--line)";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="mgravatar"
      src={playerPhotoUrl(playerId)}
      alt=""
      style={{ width: size, height: size, borderColor: ring }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

export default function ByePlanner({ leagues }: { leagues: ByeLeagueRow[] }) {
  const [pmap, setPmap] = useState<PlayerMap | null>(null);
  const [currentWeek, setCurrentWeek] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPlayers()
      .then((m) => {
        if (!cancelled) setPmap(m);
      })
      .catch(() => {});
    getState()
      .then((s) => {
        if (!cancelled) setCurrentWeek(currentProjectionWeek(s));
      })
      .catch(() => {});
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
  const loading = !pmap || currentWeek == null;

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Bye Week Planner</h1>
          <p>
            Every rostered player&rsquo;s upcoming bye, across every in-season league — bench
            players included, so you can plan a waiver pickup before it&rsquo;s a scramble.
          </p>
        </div>
      </section>

      {loading ? (
        <section className="sec">
          <p className="hint">Loading real roster and schedule data…</p>
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
              <div className="sechead">
                <h2 style={{ fontSize: 18 }}>Week {week}</h2>
                <span className="rt">
                  {rows.length} player{rows.length === 1 ? "" : "s"} on bye
                  {week === currentWeek ? " · this week" : ""}
                </span>
              </div>
              <div className="mgrtable">
                {rows.map((r, i) => {
                  const entry = pmap![r.playerId];
                  return (
                    <Link href={`/manager/${r.leagueId}`} className="mgrrow" key={`${r.leagueId}-${r.playerId}-${i}`}>
                      <Avatar playerId={r.playerId} pos={entry.p} size={26} />
                      <span className="mgrplayername">{entry.n}</span>
                      {entry.p && (
                        <span className="pos" style={posChipStyle(entry.p)}>
                          {entry.p}
                        </span>
                      )}
                      <span className="tname" style={{ flex: 1 }}>{r.leagueName}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
