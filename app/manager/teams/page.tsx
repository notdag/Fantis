import type { Metadata } from "next";
import MyTeams from "@/components/manager/MyTeams";
import { db } from "@/lib/db";
import type { MyTeamRow } from "@/components/manager/MyTeams";
import type { LeagueRosterRow } from "@/lib/leagueRank";

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

  const [leagueRows, rosterRows, matchupRows, alertRows, leagueRosterRows] = await Promise.all([
    db.league.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: "asc" } }),
    db.roster.findMany({
      select: {
        leagueId: true,
        rosterId: true,
        wins: true,
        losses: true,
        ties: true,
        waiverPosition: true,
        faabUsed: true,
      },
    }),
    // Latest week's matchup per league, fetched once and reduced in JS —
    // cheaper than 80 individual findFirst({orderBy}) round-trips.
    db.matchup.findMany({
      select: {
        leagueId: true,
        week: true,
        myPoints: true,
        opponentTeamName: true,
        opponentPoints: true,
      },
      orderBy: { week: "desc" },
    }),
    db.alert.findMany({ where: { resolvedAt: null }, select: { leagueId: true, snoozedUntil: true } }),
    db.leagueRoster.findMany({ select: { leagueId: true, rosterId: true, ownerId: true, players: true } }),
  ]);

  const rosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r]));

  const leagueRostersByLeague = new Map<string, LeagueRosterRow[]>();
  for (const r of leagueRosterRows) {
    const list = leagueRostersByLeague.get(r.leagueId) ?? [];
    list.push({ rosterId: r.rosterId, ownerId: r.ownerId, players: r.players });
    leagueRostersByLeague.set(r.leagueId, list);
  }

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
      rosterId: roster?.rosterId ?? null,
      leagueRosters: leagueRostersByLeague.get(lg.id) ?? [],
    };
  });

  return <MyTeams teams={teams} />;
}
