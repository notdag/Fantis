"use client";

import { type ManagedLeague } from "@/lib/manager";
import { sortByStanding, type LeagueRosterRow } from "@/lib/leagueRank";
import LeagueIdentityBar from "./LeagueIdentityBar";
import { SectionHead } from "./PageHead";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { Badge } from "./Badge";

export default function LeagueStandings({
  league,
  leagueRosters,
  myRosterId,
  streaksByRoster,
}: {
  league: ManagedLeague;
  leagueRosters: LeagueRosterRow[];
  myRosterId: number | null;
  streaksByRoster?: Record<number, string>;
}) {
  const myTeamName = leagueRosters.find((r) => r.rosterId === myRosterId)?.teamName ?? null;

  return (
    <>
      <LeagueIdentityBar league={league} myTeamName={myTeamName} />
      <section className="sec">
        <SectionHead title="Standings" right="real record · synced with your rosters" />
        {leagueRosters.length === 0 ? (
          <p className="hint">No standings synced yet for this league.</p>
        ) : (
          <DataTable>
            <TableHeaderRow>
              <span style={{ minWidth: 24 }}>#</span>
              <span style={{ flex: 1 }}>Team</span>
              <span style={{ minWidth: 28, textAlign: "right" }}>W</span>
              <span style={{ minWidth: 28, textAlign: "right" }}>L</span>
              <span style={{ minWidth: 28, textAlign: "right" }}>T</span>
              <span style={{ minWidth: 60, textAlign: "right" }}>PF</span>
              <span style={{ minWidth: 60, textAlign: "right" }}>PA</span>
              <span style={{ minWidth: 44, textAlign: "right" }}>Streak</span>
            </TableHeaderRow>
            {sortByStanding(leagueRosters).map((r, i) => {
              const isMe = r.rosterId === myRosterId;
              return (
                <TableRow highlight={isMe} key={r.rosterId}>
                  <span className="portmeta" style={{ minWidth: 24 }}>{i + 1}</span>
                  <span className="tname" style={{ flex: 1 }}>
                    {r.teamName ?? `Team ${r.rosterId}`}
                  </span>
                  {isMe && (
                    <Badge
                      tone={{
                        color: "var(--amber)",
                        background: "color-mix(in srgb, var(--amber) 16%, transparent)",
                        borderColor: "color-mix(in srgb, var(--amber) 45%, transparent)",
                      }}
                    >
                      You
                    </Badge>
                  )}
                  <span className="portmeta" style={{ minWidth: 28, textAlign: "right" }}>{r.wins ?? 0}</span>
                  <span className="portmeta" style={{ minWidth: 28, textAlign: "right" }}>{r.losses ?? 0}</span>
                  <span className="portmeta" style={{ minWidth: 28, textAlign: "right" }}>{r.ties ?? 0}</span>
                  <span className="portvalue" style={{ minWidth: 60, textAlign: "right" }}>
                    {r.fpts != null ? r.fpts.toFixed(1) : "—"}
                  </span>
                  <span className="portmeta" style={{ minWidth: 60, textAlign: "right" }}>
                    {r.fptsAgainst != null ? r.fptsAgainst.toFixed(1) : "—"}
                  </span>
                  <span
                    className="portmeta"
                    style={{
                      minWidth: 44,
                      textAlign: "right",
                      color: streaksByRoster?.[r.rosterId]?.startsWith("W") ? "var(--mint)" : undefined,
                    }}
                  >
                    {streaksByRoster?.[r.rosterId] ?? "—"}
                  </span>
                </TableRow>
              );
            })}
          </DataTable>
        )}
      </section>
    </>
  );
}
