"use client";

import { useMemo } from "react";
import { type ManagedLeague } from "@/lib/manager";
import { posChipStyle } from "@/lib/players";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { sortByStanding, type LeagueRosterRow } from "@/lib/leagueRank";
import { PlayerAvatar } from "./Avatar";
import LeagueIdentityBar from "./LeagueIdentityBar";
import { SectionHead } from "./PageHead";
import { DataTable, TableRow, TableRowSkeleton } from "./DataRow";

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
  const { pmap, loading: pmapLoading, error: pmapError, retry: retryPmap } = usePlayerMap();

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

      {pmapError && (
        <section className="sec">
          <p className="hint">
            Couldn&rsquo;t load player data.{" "}
            <button type="button" className="link" onClick={retryPmap}>
              Retry
            </button>
          </p>
        </section>
      )}

      {pmapError ? null : orderedTeams.length === 0 ? (
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
              <SectionHead
                title={
                  <>
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
                  </>
                }
                right={`${team.wins ?? 0}-${team.losses ?? 0}${(team.ties ?? 0) > 0 ? `-${team.ties}` : ""} · ${team.fpts != null ? `${team.fpts.toFixed(1)} pts` : "—"}`}
              />
              <DataTable>
                {players.length === 0 ? (
                  <TableRow>
                    <span className="hint">No real roster data synced for this team yet.</span>
                  </TableRow>
                ) : pmapLoading ? (
                  <TableRowSkeleton count={players.length} />
                ) : (
                  players.map((id) => {
                    const entry = pmap?.[id];
                    return (
                      <TableRow key={id}>
                        <PlayerAvatar playerId={id} pos={entry?.p} size={26} />
                        <span className="tname" style={{ flex: 1 }}>{entry?.n ?? id}</span>
                        {entry?.p && (
                          <span className="pos" style={posChipStyle(entry.p)}>
                            {entry.p}
                          </span>
                        )}
                        <span className="portmeta">{entry?.t ?? ""}</span>
                      </TableRow>
                    );
                  })
                )}
              </DataTable>
            </section>
          );
        })
      )}

      {bestAvailable.length > 0 && (
        <section className="sec">
          <SectionHead title="Best available in this league" right="real season points · not on any roster here" />
          <DataTable>
            {bestAvailable.map((p) => (
              <TableRow key={p.id}>
                <PlayerAvatar playerId={p.id} pos={p.pos} size={26} />
                <span className="tname" style={{ flex: 1 }}>{p.name}</span>
                <span className="pos" style={posChipStyle(p.pos)}>{p.pos}</span>
                <span className="portmeta">{p.team}</span>
                <span className="portvalue">{Math.round(p.pts)} pts</span>
              </TableRow>
            ))}
          </DataTable>
        </section>
      )}
    </>
  );
}
