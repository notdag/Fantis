import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// Real past results for one week, across every league — a pure DB read (already
// synced by the regular sync, no Sleeper call here). `won` comes from
// WeeklyResult, which the sync already resolves honestly (null for a bye/odd
// matchup, never guessed); Matchup supplies the opponent's name/score for
// display. Owner-only like the rest of /manager.
export async function GET(req: Request) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const week = Number(new URL(req.url).searchParams.get("week"));
  if (!Number.isInteger(week) || week < 1 || week > 25) {
    return NextResponse.json({ error: "week must be an integer between 1 and 25." }, { status: 400 });
  }

  const rosters = await db.roster.findMany({ select: { leagueId: true, rosterId: true } });
  const myRosterByLeague = new Map(rosters.map((r) => [r.leagueId, r.rosterId]));
  const leagueIds = [...myRosterByLeague.keys()];

  const [weekly, matchups, leagues] = await Promise.all([
    db.weeklyResult.findMany({ where: { week, leagueId: { in: leagueIds } }, select: { leagueId: true, rosterId: true, points: true, won: true } }),
    db.matchup.findMany({ where: { week, leagueId: { in: leagueIds } }, select: { leagueId: true, opponentTeamName: true, opponentPoints: true } }),
    db.league.findMany({ where: { id: { in: leagueIds } }, select: { id: true, name: true, status: true } }),
  ]);
  const nameById = new Map(leagues.map((l) => [l.id, l.name]));
  const statusById = new Map(leagues.map((l) => [l.id, l.status]));
  const matchupByLeague = new Map(matchups.map((m) => [m.leagueId, m]));

  const rows = weekly
    .filter((w) => myRosterByLeague.get(w.leagueId) === w.rosterId)
    .map((w) => {
      const m = matchupByLeague.get(w.leagueId);
      return {
        leagueId: w.leagueId,
        leagueName: nameById.get(w.leagueId) ?? w.leagueId,
        points: w.points,
        won: w.won,
        opponentPoints: m?.opponentPoints ?? null,
        opponentTeamName: m?.opponentTeamName ?? null,
      };
    });
  // A league with no row at all for this week (never played it — too early, or
  // the roster wasn't in a live matchup that week) is reported separately so it
  // is never mistaken for a loss or a bye.
  const covered = new Set(rows.map((r) => r.leagueId));
  const noData = leagueIds.filter((id) => !covered.has(id) && statusById.get(id) !== "pre_draft" && statusById.get(id) !== "drafting").map((id) => nameById.get(id) ?? id);

  return NextResponse.json({ week, rows, noData });
}
