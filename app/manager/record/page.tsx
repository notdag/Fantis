import type { Metadata } from "next";
import WeeklyRecord from "@/components/manager/WeeklyRecord";
import { db } from "@/lib/db";
import { isBestBall } from "@/lib/manager";
import type { WeeklyRecordLeague } from "@/components/manager/WeeklyRecord";

export const metadata: Metadata = {
  title: "Fantis — Weekly Record",
  robots: { index: false, follow: false },
};

export default async function RecordPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Weekly Record</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  // Pure DB read, no Sleeper call — WeeklyResult/Matchup are already synced
  // by the regular sync, same source the "what was my record for week N"
  // chat command uses (app/api/manager/week-record/route.ts), just every
  // week at once instead of one.
  const rosterRows = await db.roster.findMany({ select: { leagueId: true, rosterId: true } });
  const leagueIds = rosterRows.map((r) => r.leagueId);
  const myRosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r.rosterId]));

  const [leagueRows, weeklyRows, matchupRows] = await Promise.all([
    db.league.findMany({ where: { id: { in: leagueIds }, status: "in_season" }, select: { id: true, name: true, settings: true }, orderBy: { name: "asc" } }),
    db.weeklyResult.findMany({ where: { leagueId: { in: leagueIds } }, select: { leagueId: true, week: true, rosterId: true, points: true, won: true } }),
    db.matchup.findMany({ where: { leagueId: { in: leagueIds } }, select: { leagueId: true, week: true, opponentTeamName: true, opponentPoints: true } }),
  ]);

  const matchupByKey = new Map(matchupRows.map((m) => [`${m.leagueId}:${m.week}`, m]));

  const leagues: WeeklyRecordLeague[] = leagueRows
    .map((lg) => {
      const myRosterId = myRosterByLeague.get(lg.id);
      const weeks = weeklyRows
        .filter((w) => w.leagueId === lg.id && w.rosterId === myRosterId)
        .map((w) => {
          const m = matchupByKey.get(`${lg.id}:${w.week}`);
          return { week: w.week, points: w.points, won: w.won, opponentTeamName: m?.opponentTeamName ?? null, opponentPoints: m?.opponentPoints ?? null };
        })
        // A league whose real Sleeper draft happened AFTER a given week's
        // games had already started leaves that week's matchup as a 0-0
        // placeholder against a real, named opponent — Sleeper's data, not
        // a bug in the sync (confirmed directly: 109 leagues showed this
        // for week 1 only, and it fully disappears from week 2 on). Scored
        // 0-0, it isn't distinguishable from a genuine tie by the numbers
        // alone, but a real tie needs someone to have actually played —
        // this wasn't a real week for that league at all, so it's dropped
        // here rather than counted as "tied" (or even a bye, which has no
        // opponent). A real 0-0 tie is not possible in fantasy scoring.
        .filter((w) => !(w.won === null && w.points === 0 && w.opponentPoints === 0))
        .sort((a, b) => a.week - b.week);
      return { leagueId: lg.id, leagueName: lg.name, bestBall: isBestBall(lg.settings), weeks };
    })
    .filter((l) => l.weeks.length > 0);

  return <WeeklyRecord leagues={leagues} />;
}
