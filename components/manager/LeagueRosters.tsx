"use client";

import { useEffect, useMemo, useState } from "react";
import { type ManagedLeague } from "@/lib/manager";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import { sortByStanding, type LeagueRosterRow } from "@/lib/leagueRank";
import LeagueIdentityBar from "./LeagueIdentityBar";
import type { PlayerMap } from "@/lib/types";

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

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

// Real, every-team roster grid — the data (leagueRosters) was already
// fetched for Standings/best-available before this route existed; this
// is the one genuinely new page in the 8-way split, per the audit's
// "data exists but no dedicated UI route today" finding.
export default function LeagueRosters({
  league,
  leagueRosters,
  myRosterId,
}: {
  league: ManagedLeague;
  leagueRosters: LeagueRosterRow[];
  myRosterId: number | null;
}) {
  const [pmap, setPmap] = useState<PlayerMap | null>(null);
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

  const seasonTotals = useSeasonTotals();
  const OFFENSE_POS = useMemo(() => new Set(["QB", "RB", "WR", "TE"]), []);

  const bestAvailable = useMemo(() => {
    if (!pmap || !seasonTotals || leagueRosters.length === 0) return [];
    const rostered = new Set(leagueRosters.flatMap((r) => r.players));
    const rows: { id: string; name: string; pos: string; team: string; pts: number }[] = [];
    for (const id in pmap) {
      if (rostered.has(id)) continue;
      const p = pmap[id];
      if (!OFFENSE_POS.has(p.p) || !p.t) continue;
      const pts = seasonTotals[id]?.pts;
      if (!pts || pts <= 0) continue;
      rows.push({ id, name: p.n, pos: p.p, team: p.t, pts });
    }
    rows.sort((a, b) => b.pts - a.pts);
    return rows.slice(0, 10);
  }, [pmap, seasonTotals, leagueRosters, OFFENSE_POS]);

  const orderedTeams = useMemo(() => sortByStanding(leagueRosters), [leagueRosters]);

  return (
    <>
      <LeagueIdentityBar league={league} />

      {orderedTeams.length === 0 ? (
        <section className="sec">
          <p className="hint">No rosters synced yet for this league.</p>
        </section>
      ) : (
        orderedTeams.map((team) => {
          const players = [...team.players].sort((a, b) => {
            const pa = pmap?.[a]?.p ?? "";
            const pb = pmap?.[b]?.p ?? "";
            return (POS_ORDER[pa] ?? 9) - (POS_ORDER[pb] ?? 9);
          });
          return (
            <section className="sec" key={team.rosterId}>
              <div className="sechead">
                <h2 style={{ fontSize: 18 }}>
                  {team.teamName ?? `Team ${team.rosterId}`}
                  {team.rosterId === myRosterId && (
                    <span
                      className="pos"
                      style={{
                        marginLeft: 8,
                        color: "var(--amber)",
                        background: "color-mix(in srgb, var(--amber) 16%, transparent)",
                        borderColor: "color-mix(in srgb, var(--amber) 45%, transparent)",
                      }}
                    >
                      You
                    </span>
                  )}
                </h2>
                <span className="rt">
                  {team.wins ?? 0}-{team.losses ?? 0}
                  {(team.ties ?? 0) > 0 ? `-${team.ties}` : ""} ·{" "}
                  {team.fpts != null ? `${team.fpts.toFixed(1)} pts` : "—"}
                </span>
              </div>
              <div className="mgrtable">
                {players.length === 0 ? (
                  <div className="mgrrow static">
                    <span className="hint">No real roster data synced for this team yet.</span>
                  </div>
                ) : (
                  players.map((id) => {
                    const entry = pmap?.[id];
                    return (
                      <div className="mgrrow static" key={id}>
                        <Avatar playerId={id} pos={entry?.p} size={26} />
                        <span className="tname" style={{ flex: 1 }}>{entry?.n ?? id}</span>
                        {entry?.p && (
                          <span className="pos" style={posChipStyle(entry.p)}>
                            {entry.p}
                          </span>
                        )}
                        <span className="portmeta">{entry?.t ?? ""}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          );
        })
      )}

      {bestAvailable.length > 0 && (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>Best available in this league</h2>
            <span className="rt">real season points · not on any roster here</span>
          </div>
          <div className="mgrtable">
            {bestAvailable.map((p) => (
              <div className="mgrrow static" key={p.id}>
                <Avatar playerId={p.id} pos={p.pos} size={26} />
                <span className="tname" style={{ flex: 1 }}>{p.name}</span>
                <span className="pos" style={posChipStyle(p.pos)}>{p.pos}</span>
                <span className="portmeta">{p.team}</span>
                <span className="portvalue">{Math.round(p.pts)} pts</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
