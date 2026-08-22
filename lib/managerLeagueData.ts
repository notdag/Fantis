// Shared server-side fetch for every /manager/[leagueId]/* route — extracted
// from the old single-page [leagueId]/page.tsx so the 8-way route split
// (overview/team/rosters/standings/transactions/draft/info/matchup) reuses
// one real query instead of 8 near-duplicates. Real, unauthenticated Prisma
// reads only — no Sleeper calls here (that's sync's job).
import { db } from "./db";
import type { ManagedAlert, ManagedDraft, ManagedLeague, ManagedMatchup, ManagedRoster } from "./manager";
import type { LeagueRosterRow } from "./leagueRank";

export interface LeagueDetailData {
  league: ManagedLeague;
  roster: ManagedRoster | null;
  matchup: ManagedMatchup | null;
  alerts: ManagedAlert[];
  draft: ManagedDraft | null;
  leagueRosters: LeagueRosterRow[];
}

export async function getLeagueDetailData(leagueId: string): Promise<LeagueDetailData | null> {
  const row = await db.league.findUnique({
    where: { id: leagueId },
    include: { account: true },
  });
  if (!row) return null;

  const league: ManagedLeague = {
    id: row.id,
    accountId: row.accountId,
    accountUsername: row.account.username,
    name: row.name,
    season: row.season,
    totalRosters: row.totalRosters,
    status: row.status,
    settings: row.settings,
    group: row.group,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  };

  const [rosterRow, matchupRow, alertRows, draftRow, leagueRosterRows] = await Promise.all([
    db.roster.findUnique({ where: { leagueId } }),
    db.matchup.findFirst({ where: { leagueId }, orderBy: { week: "desc" } }),
    db.alert.findMany({ where: { leagueId, resolvedAt: null }, orderBy: { createdAt: "asc" } }),
    db.draft.findFirst({ where: { leagueId } }),
    db.leagueRoster.findMany({
      where: { leagueId },
      select: {
        rosterId: true,
        ownerId: true,
        players: true,
        wins: true,
        losses: true,
        ties: true,
        fpts: true,
        fptsAgainst: true,
        teamName: true,
      },
    }),
  ]);

  const roster: ManagedRoster | null = rosterRow
    ? {
        leagueId: rosterRow.leagueId,
        rosterId: rosterRow.rosterId,
        starters: rosterRow.starters,
        players: rosterRow.players,
        reserve: rosterRow.reserve,
        waiverPosition: rosterRow.waiverPosition,
        faabUsed: rosterRow.faabUsed,
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
        myProjPoints: matchupRow.myProjPoints,
        myStartersProjPoints: matchupRow.myStartersProjPoints,
        opponentTeamName: matchupRow.opponentTeamName,
        opponentPoints: matchupRow.opponentPoints,
        opponentStarters: matchupRow.opponentStarters,
        opponentStartersPoints: matchupRow.opponentStartersPoints,
        opponentProjPoints: matchupRow.opponentProjPoints,
        opponentStartersProjPoints: matchupRow.opponentStartersProjPoints,
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

  return { league, roster, matchup, alerts, draft, leagueRosters: leagueRosterRows };
}
