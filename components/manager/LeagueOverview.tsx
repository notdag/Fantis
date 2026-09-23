"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  type ManagedAlert,
  type ManagedDraft,
  type ManagedLeague,
  type ManagedMatchup,
  type ManagedRoster,
  type ManagedTransaction,
  formatUpcoming,
  statusChipStyle,
  transactionTypeChipStyle,
  transactionTypeLabel,
} from "@/lib/manager";
import { posChipStyle } from "@/lib/players";
import { buildStartingSlots } from "@/lib/rosterSlots";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { computeLeagueRank, computeStanding, sortByStanding, type LeagueRosterRow } from "@/lib/leagueRank";
import AlertRow from "./AlertRow";
import { PlayerAvatar } from "./Avatar";
import LeagueIdentityBar from "./LeagueIdentityBar";
import { IconCheck, IconStar, IconCalendar, IconShield } from "./MgrIcons";
import { SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableRowSkeleton } from "./DataRow";

const ROSTER_PREVIEW_SLOTS = 5;

// Real summary of a league — a 3-row grid (hero stats, then roster+matchup
// side by side, then standings+recent activity side by side), each detail
// linking to its own full route. This is the one page in the 8-way split
// that genuinely summarizes rather than relocating a section wholesale.
export default function LeagueOverview({
  league,
  roster,
  matchup,
  alerts,
  draft,
  leagueRosters,
  recentTransactions,
  rosterPositions,
}: {
  league: ManagedLeague;
  roster: ManagedRoster | null;
  matchup: ManagedMatchup | null;
  alerts: ManagedAlert[];
  draft: ManagedDraft | null;
  leagueRosters: LeagueRosterRow[];
  recentTransactions: ManagedTransaction[];
  rosterPositions: string[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { pmap, loading: pmapLoading, error: pmapError, retry: retryPmap } = usePlayerMap();

  const seasonTotals = useSeasonTotals();
  const leagueRank = useMemo(
    () => (roster ? computeLeagueRank(leagueRosters, roster.rosterId, seasonTotals) : null),
    [leagueRosters, roster, seasonTotals]
  );
  const standing = useMemo(
    () => (roster ? computeStanding(leagueRosters, roster.rosterId) : null),
    [leagueRosters, roster]
  );

  const draftIdRaw = league.settings && typeof league.settings === "object"
    ? (league.settings as Record<string, unknown>).draft_id
    : undefined;
  const showDraftCard = draft != null && (league.status === "pre_draft" || league.status === "drafting");

  const standingsPreview = useMemo(() => sortByStanding(leagueRosters).slice(0, 5), [leagueRosters]);

  const rosterSlotsPreview = useMemo(() => {
    if (!roster) return [];
    return buildStartingSlots(rosterPositions).slice(0, ROSTER_PREVIEW_SLOTS);
  }, [roster, rosterPositions]);

  const myTeamName = roster ? leagueRosters.find((r) => r.rosterId === roster.rosterId)?.teamName ?? null : null;

  return (
    <>
      <LeagueIdentityBar league={league} myTeamName={myTeamName} />

      {/* Row 1 — hero stats */}
      {(roster || showDraftCard) && (
        <section className="sec">
          <StatCardGrid variant="grid">
            {roster && (
              <StatCard
                icon={IconCheck}
                label="Record"
                value={`${roster.wins}-${roster.losses}${roster.ties > 0 ? `-${roster.ties}` : ""}`}
              />
            )}

            {roster && standing?.standing != null && (
              <StatCard
                icon={IconShield}
                color={standing.standing <= standing.totalTeams / 2 ? "var(--mint)" : "var(--muted)"}
                label="Standing"
                value={`#${standing.standing} of ${standing.totalTeams}`}
              />
            )}

            {roster && roster.fpts != null && (
              <StatCard label="Points for" value={roster.fpts.toFixed(1)} />
            )}

            {roster && roster.fptsAgainst != null && (
              <StatCard label="Points against" value={roster.fptsAgainst.toFixed(1)} />
            )}

            {roster && leagueRank?.rank != null && (
              <StatCard
                icon={IconStar}
                color={leagueRank.rank <= leagueRank.totalTeams / 2 ? "var(--mint)" : "var(--muted)"}
                label="League rank"
                value={`#${leagueRank.rank} of ${leagueRank.totalTeams}`}
                sub={leagueRank.myValue != null ? `team value ${Math.round(leagueRank.myValue)} pts` : undefined}
              />
            )}

            {showDraftCard && draft && (
              <StatCard
                icon={IconCalendar}
                color={statusChipStyle(league.status).color}
                label="Draft"
                value={mounted ? (draft.status === "drafting" ? "Drafting now" : formatUpcoming(draft.startTime)) : "—"}
                sub={
                  typeof draftIdRaw === "string" ? (
                    <Link href={`/manager/${league.id}/draft`} className="link">
                      View draft →
                    </Link>
                  ) : undefined
                }
              />
            )}
          </StatCardGrid>
        </section>
      )}

      {alerts.length > 0 && (
        <section className="sec">
          <SectionHead title="Alerts" right={`${alerts.length} from the last sync`} />
          <div className="tradeinbox">
            {[...alerts]
              .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "action_required" ? -1 : 1))
              .map((a) => (
                <AlertRow key={a.id} alert={a} mounted={mounted} />
              ))}
          </div>
        </section>
      )}

      {/* Row 2 — My Team (left) / Matchup (right) */}
      {(roster || matchup) && (
        <section className="sec">
          <div className="mgroverviewgrid">
            {roster && (
              <div>
                <SectionHead
                  title="My Team"
                  right={
                    <Link href={`/manager/${league.id}/team`} className="link">
                      View full roster →
                    </Link>
                  }
                />
                {pmapError ? (
                  <p className="hint">
                    Couldn&rsquo;t load player data.{" "}
                    <button type="button" className="link" onClick={retryPmap}>
                      Retry
                    </button>
                  </p>
                ) : (
                  <DataTable>
                    {pmapLoading ? (
                      <TableRowSkeleton count={ROSTER_PREVIEW_SLOTS} />
                    ) : (
                      rosterSlotsPreview.map((slot, i) => {
                        const playerId = roster.starters[i];
                        const empty = !playerId || playerId === "0";
                        const entry = empty ? null : pmap?.[playerId];
                        return (
                          <TableRow key={slot.key}>
                            <span className="portmeta" style={{ minWidth: 44 }}>{slot.code}</span>
                            {empty ? (
                              <span className="tname" style={{ color: "var(--red)" }}>Empty slot</span>
                            ) : (
                              <>
                                <PlayerAvatar playerId={playerId} pos={entry?.p} size={26} />
                                <span className="tname" style={{ flex: 1 }}>{entry?.n ?? playerId}</span>
                                {entry?.p && (
                                  <span className="pos" style={posChipStyle(entry.p)}>
                                    {entry.p}
                                  </span>
                                )}
                              </>
                            )}
                          </TableRow>
                        );
                      })
                    )}
                  </DataTable>
                )}
              </div>
            )}

            {matchup && (
              <div>
                <SectionHead
                  title={<>This week&rsquo;s matchup</>}
                  right={
                    <Link href={`/manager/${league.id}/matchup`} className="link">
                      View full →
                    </Link>
                  }
                />
                <div className="portoverview">
                  <div className="portoverviewrow" style={{ cursor: "default" }}>
                    <span className="tname">You</span>
                    <span className="portvalue">{matchup.myPoints.toFixed(1)}</span>
                  </div>
                  <div className="portoverviewrow" style={{ cursor: "default" }}>
                    <span className="tname">{matchup.opponentTeamName ?? "Opponent"}</span>
                    <span className="portvalue">
                      {matchup.opponentPoints != null ? matchup.opponentPoints.toFixed(1) : "—"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Row 3 — Standings (left) / Recent activity (right) */}
      {(roster && leagueRosters.length > 0) || recentTransactions.length > 0 ? (
        <section className="sec">
          <div className="mgroverviewgrid">
            {roster && leagueRosters.length > 0 && (
              <div>
                <SectionHead
                  title="Standings"
                  right={
                    <Link href={`/manager/${league.id}/standings`} className="link">
                      View full standings →
                    </Link>
                  }
                />
                <DataTable>
                  {standingsPreview.map((r, i) => {
                    const isMe = r.rosterId === roster.rosterId;
                    return (
                      <TableRow highlight={isMe} key={r.rosterId}>
                        <span className="portmeta" style={{ minWidth: 24 }}>{i + 1}</span>
                        <span className="tname" style={{ flex: 1 }}>{r.teamName ?? `Team ${r.rosterId}`}</span>
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
              </div>
            )}

            <div>
              <SectionHead
                title="Recent activity"
                right={
                  <Link href={`/manager/${league.id}/transactions`} className="link">
                    View all →
                  </Link>
                }
              />
              {recentTransactions.length === 0 ? (
                <p className="hint">No transactions synced yet for this league.</p>
              ) : (
                <DataTable>
                  {recentTransactions.map((t) => (
                    <TableRow key={t.id}>
                      <span className="pos" style={transactionTypeChipStyle(t.type)}>
                        {transactionTypeLabel(t.type)}
                      </span>
                      <span className="portmeta" style={{ flex: 1 }}>
                        {t.adds && t.adds.length > 0 && (
                          <span style={{ color: "var(--mint)" }}>+ {t.adds.map((p) => p.playerName).join(", ")}</span>
                        )}
                        {t.adds && t.adds.length > 0 && t.drops && t.drops.length > 0 && " · "}
                        {t.drops && t.drops.length > 0 && (
                          <span style={{ color: "var(--red)" }}>− {t.drops.map((p) => p.playerName).join(", ")}</span>
                        )}
                      </span>
                    </TableRow>
                  ))}
                </DataTable>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
