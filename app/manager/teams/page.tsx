import type { Metadata } from "next";
import MyTeams from "@/components/manager/MyTeams";
import { db } from "@/lib/db";
import type { MyTeamRow } from "@/components/manager/MyTeams";

export const metadata: Metadata = {
  title: "Fantis — My Teams",
  robots: { index: false, follow: false },
};

export default async function TeamsPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>My Teams</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const [leagueRows, rosterRows, matchupRows, alertRows] = await Promise.all([
    db.league.findMany({ orderBy: { name: "asc" } }),
    db.roster.findMany(),
    // Latest week's matchup per league, fetched once and reduced in JS —
    // cheaper than 80 individual findFirst({orderBy}) round-trips.
    db.matchup.findMany({ orderBy: { week: "desc" } }),
    db.alert.findMany({ where: { resolvedAt: null }, select: { leagueId: true, snoozedUntil: true } }),
  ]);

  const rosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r]));

  const latestMatchupByLeague = new Map<string, (typeof matchupRows)[number]>();
  for (const m of matchupRows) {
    if (!latestMatchupByLeague.has(m.leagueId)) latestMatchupByLeague.set(m.leagueId, m);
  }

  // Same "snoozed drops out of the needs-attention count" rule as
  // Today/Commissioner/Player search.
  const now = new Date();
  const alertCountByLeague = new Map<string, number>();
  for (const a of alertRows) {
    if (a.snoozedUntil && a.snoozedUntil > now) continue;
    alertCountByLeague.set(a.leagueId, (alertCountByLeague.get(a.leagueId) ?? 0) + 1);
  }

  const teams: MyTeamRow[] = leagueRows.map((lg) => {
    const roster = rosterByLeague.get(lg.id) ?? null;
    const matchup = latestMatchupByLeague.get(lg.id) ?? null;
    return {
      leagueId: lg.id,
      leagueName: lg.name,
      status: lg.status,
      wins: roster?.wins ?? null,
      losses: roster?.losses ?? null,
      ties: roster?.ties ?? null,
      myPoints: matchup?.myPoints ?? null,
      opponentTeamName: matchup?.opponentTeamName ?? null,
      opponentPoints: matchup?.opponentPoints ?? null,
      week: matchup?.week ?? null,
      alertCount: alertCountByLeague.get(lg.id) ?? 0,
      waiverPosition: roster?.waiverPosition ?? null,
      faabUsed: roster?.faabUsed ?? null,
    };
  });

  return <MyTeams teams={teams} />;
}
