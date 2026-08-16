import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LeagueDetail from "@/components/manager/LeagueDetail";
import { db } from "@/lib/db";
import type { ManagedAlert, ManagedDraft, ManagedLeague, ManagedMatchup, ManagedRoster } from "@/lib/manager";

export const metadata: Metadata = {
  title: "Fantis — Sleeper Manager",
  robots: { index: false, follow: false },
};

export default async function ManagerLeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Sleeper Manager</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment.
        </p>
      </section>
    );
  }

  const row = await db.league.findUnique({
    where: { id: leagueId },
    include: { account: true },
  });
  if (!row) notFound();

  const league: ManagedLeague = {
    id: row.id,
    accountId: row.accountId,
    accountUsername: row.account.username,
    name: row.name,
    season: row.season,
    totalRosters: row.totalRosters,
    status: row.status,
    settings: row.settings,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  };

  const [rosterRow, matchupRow, alertRows, draftRow] = await Promise.all([
    db.roster.findUnique({ where: { leagueId } }),
    db.matchup.findFirst({ where: { leagueId }, orderBy: { week: "desc" } }),
    db.alert.findMany({ where: { leagueId, resolvedAt: null }, orderBy: { createdAt: "asc" } }),
    db.draft.findFirst({ where: { leagueId } }),
  ]);

  const roster: ManagedRoster | null = rosterRow
    ? {
        leagueId: rosterRow.leagueId,
        rosterId: rosterRow.rosterId,
        starters: rosterRow.starters,
        players: rosterRow.players,
        wins: rosterRow.wins,
        losses: rosterRow.losses,
        ties: rosterRow.ties,
        fpts: rosterRow.fpts,
        fptsAgainst: rosterRow.fptsAgainst,
        lastSyncedAt: rosterRow.lastSyncedAt?.toISOString() ?? null,
      }
    : null;

  const matchup: ManagedMatchup | null = matchupRow
    ? {
        week: matchupRow.week,
        myPoints: matchupRow.myPoints,
        myStarters: matchupRow.myStarters,
        myStartersPoints: matchupRow.myStartersPoints,
        opponentTeamName: matchupRow.opponentTeamName,
        opponentPoints: matchupRow.opponentPoints,
        opponentStarters: matchupRow.opponentStarters,
        opponentStartersPoints: matchupRow.opponentStartersPoints,
      }
    : null;

  const alerts: ManagedAlert[] = alertRows.map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity as "action_required" | "review",
    message: a.message,
    playerId: a.playerId,
    week: a.week,
    createdAt: a.createdAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    snoozedUntil: a.snoozedUntil?.toISOString() ?? null,
  }));

  const draft: ManagedDraft | null = draftRow
    ? {
        id: draftRow.id,
        status: draftRow.status,
        type: draftRow.type,
        startTime: draftRow.startTime?.toISOString() ?? null,
      }
    : null;

  return <LeagueDetail league={league} roster={roster} matchup={matchup} alerts={alerts} draft={draft} />;
}
