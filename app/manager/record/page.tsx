import type { Metadata } from "next";
import WeeklyRecord from "@/components/manager/WeeklyRecord";
import { db } from "@/lib/db";
import { isBestBall } from "@/lib/manager";
import { getStateCached } from "@/lib/stateCache";
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
    db.league.findMany({ where: { id: { in: leagueIds }, status: "in_season" }, select: { id: true, name: true, settings: true, group: true }, orderBy: { name: "asc" } }),
    db.weeklyResult.findMany({ where: { leagueId: { in: leagueIds } }, select: { leagueId: true, week: true, rosterId: true, points: true, won: true } }),
    db.matchup.findMany({ where: { leagueId: { in: leagueIds } }, select: { leagueId: true, week: true, opponentTeamName: true, opponentPoints: true, opponentRosterId: true } }),
  ]);

  // Only finished weeks count: Sleeper's current week (still being played) holds live, partial scores that would
  // read as wins/losses. It joins the page once Sleeper rolls over to the next week (Tuesday).
  const state = await getStateCached();
  const currentWeek = state?.week ?? null;
  const matchupByKey = new Map(matchupRows.map((m) => [`${m.leagueId}:${m.week}`, m]));
  // The opponent's FINAL score comes from WeeklyResult (re-read after the week ends); Matchup rows can hold a
  // mid-week snapshot.
  const pointsByRoster = new Map(weeklyRows.map((w) => [`${w.leagueId}:${w.week}:${w.rosterId}`, w.points]));

  const leagues: WeeklyRecordLeague[] = leagueRows
    .map((lg) => {
      const myRosterId = myRosterByLeague.get(lg.id);
      const weeks = weeklyRows
        .filter((w) => w.leagueId === lg.id && w.rosterId === myRosterId && (currentWeek == null || w.week < currentWeek))
        .map((w) => {
          const m = matchupByKey.get(`${lg.id}:${w.week}`);
          const oppFinal = m?.opponentRosterId != null ? pointsByRoster.get(`${lg.id}:${w.week}:${m.opponentRosterId}`) : undefined;
          return { week: w.week, points: w.points, won: w.won, opponentTeamName: m?.opponentTeamName ?? null, opponentPoints: oppFinal ?? m?.opponentPoints ?? null };
        })
        // A completed past week where BOTH sides show exactly 0 points is
        // never a real result — confirmed directly against Sleeper's own
        // live API (real, non-zero scores existed there the whole time).
        // The real cause was a sync bug, now fixed at the source
        // (lib/managerSync.ts's backfill self-heals a stale all-zero week
        // on the next sync) — this filter is just a defensive backstop so a
        // display page never shows a fake "tie" even for the brief window
        // before that fix has re-synced this account, or if the exact same
        // failure mode ever recurs for a different reason.
        .filter((w) => !(w.won === null && w.points === 0 && w.opponentPoints === 0))
        .sort((a, b) => a.week - b.week);
      return { leagueId: lg.id, leagueName: lg.name, group: lg.group, bestBall: isBestBall(lg.settings), weeks };
    })
    .filter((l) => l.weeks.length > 0);

  return <WeeklyRecord leagues={leagues} />;
}
