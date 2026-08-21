"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  type ManagedAlert,
  type ManagedDraft,
  type ManagedLeague,
  type ManagedMatchup,
  type ManagedRoster,
  formatUpcoming,
  statusChipStyle,
} from "@/lib/manager";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import { computeLeagueRank, computeStanding, sortByStanding, type LeagueRosterRow } from "@/lib/leagueRank";
import AlertRow from "./AlertRow";
import LeagueIdentityBar from "./LeagueIdentityBar";
import { IconCheck, IconStar, IconCalendar, IconShield } from "./MgrIcons";
import { SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";

// Real summary of a league — hero stats plus a short preview of each
// detail tab (matchup/standings), each linking to its own full route.
// This is the one page in the 8-way split that genuinely summarizes
// rather than just relocating a section wholesale, per the "summarize
// and link, don't cram everything on one page" ask.
export default function LeagueOverview({
  league,
  roster,
  matchup,
  alerts,
  draft,
  leagueRosters,
}: {
  league: ManagedLeague;
  roster: ManagedRoster | null;
  matchup: ManagedMatchup | null;
  alerts: ManagedAlert[];
  draft: ManagedDraft | null;
  leagueRosters: LeagueRosterRow[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

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

  return (
    <>
      <LeagueIdentityBar league={league} />

      {(roster || showDraftCard) && (
        <section className="sec">
          <StatCardGrid variant="grid">
            {roster && (
              <StatCard
                icon={IconCheck}
                label="Record"
                value={`${roster.wins}-${roster.losses}${roster.ties > 0 ? `-${roster.ties}` : ""}`}
                sub={
                  roster.fpts != null && roster.fptsAgainst != null
                    ? `PF ${roster.fpts.toFixed(1)} · PA ${roster.fptsAgainst.toFixed(1)}`
                    : undefined
                }
              />
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

            {roster && standing?.standing != null && (
              <StatCard
                icon={IconShield}
                color={standing.standing <= standing.totalTeams / 2 ? "var(--mint)" : "var(--muted)"}
                label="Standing"
                value={`#${standing.standing} of ${standing.totalTeams}`}
                sub={`real record · ${roster.wins}-${roster.losses}${roster.ties > 0 ? `-${roster.ties}` : ""}`}
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

      {matchup && (
        <section className="sec">
          <SectionHead
            title={<>This week&rsquo;s matchup</>}
            right={
              <Link href={`/manager/${league.id}/matchup`} className="link">
                View full matchup →
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
        </section>
      )}

      {roster && leagueRosters.length > 0 && (
        <section className="sec">
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
        </section>
      )}

      {roster && (
        <section className="sec">
          <SectionHead
            title="My Team"
            right={
              <Link href={`/manager/${league.id}/team`} className="link">
                View full roster →
              </Link>
            }
          />
          <div className="hint">
            {roster.wins}-{roster.losses}
            {roster.ties > 0 ? `-${roster.ties}` : ""} ·{" "}
            {roster.waiverPosition != null ? `waiver #${roster.waiverPosition} · ` : ""}
            {roster.faabUsed != null ? `$${roster.faabUsed} FAAB used` : ""}
          </div>
        </section>
      )}
    </>
  );
}
