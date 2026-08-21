"use client";

import { type ManagedLeague } from "@/lib/manager";
import { sortByStanding, type LeagueRosterRow } from "@/lib/leagueRank";
import LeagueIdentityBar from "./LeagueIdentityBar";
import { SectionHead } from "./PageHead";
import { DataTable, TableRow } from "./DataRow";

export default function LeagueStandings({
  league,
  leagueRosters,
  myRosterId,
}: {
  league: ManagedLeague;
  leagueRosters: LeagueRosterRow[];
  myRosterId: number | null;
}) {
  return (
    <>
      <LeagueIdentityBar league={league} />
      <section className="sec">
        <SectionHead title="Standings" right="real record · synced with your rosters" />
        {leagueRosters.length === 0 ? (
          <p className="hint">No standings synced yet for this league.</p>
        ) : (
          <DataTable>
            {sortByStanding(leagueRosters).map((r, i) => {
              const isMe = r.rosterId === myRosterId;
              return (
                <TableRow highlight={isMe} key={r.rosterId}>
                  <span className="portmeta" style={{ minWidth: 24 }}>{i + 1}</span>
                  <span className="tname" style={{ flex: 1 }}>
                    {r.teamName ?? `Team ${r.rosterId}`}
                  </span>
                  {isMe && (
                    <span
                      className="pos"
                      style={{
                        color: "var(--amber)",
                        background: "color-mix(in srgb, var(--amber) 16%, transparent)",
                        borderColor: "color-mix(in srgb, var(--amber) 45%, transparent)",
                      }}
                    >
                      You
                    </span>
                  )}
                  <span className="portmeta">
                    {r.wins ?? 0}-{r.losses ?? 0}
                    {(r.ties ?? 0) > 0 ? `-${r.ties}` : ""}
                  </span>
                  <span className="portvalue">{r.fpts != null ? `${r.fpts.toFixed(1)} pts` : "—"}</span>
                </TableRow>
              );
            })}
          </DataTable>
        )}
      </section>
    </>
  );
}
