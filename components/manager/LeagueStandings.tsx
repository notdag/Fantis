"use client";

import { type ManagedLeague } from "@/lib/manager";
import { sortByStanding, type LeagueRosterRow } from "@/lib/leagueRank";
import LeagueIdentityBar from "./LeagueIdentityBar";

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
        <div className="sechead">
          <h2 style={{ fontSize: 18 }}>Standings</h2>
          <span className="rt">real record · synced with your rosters</span>
        </div>
        {leagueRosters.length === 0 ? (
          <p className="hint">No standings synced yet for this league.</p>
        ) : (
          <div className="mgrtable">
            {sortByStanding(leagueRosters).map((r, i) => {
              const isMe = r.rosterId === myRosterId;
              return (
                <div
                  className="mgrrow static"
                  key={r.rosterId}
                  style={isMe ? { background: "color-mix(in srgb, var(--amber) 10%, transparent)" } : undefined}
                >
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
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
