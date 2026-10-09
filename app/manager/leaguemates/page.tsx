import type { Metadata } from "next";
import LeagueMates, { type LeagueMate } from "@/components/manager/LeagueMates";
import { db } from "@/lib/db";
import { getStateCached } from "@/lib/stateCache";

export const metadata: Metadata = {
  title: "Fantis — LeagueMates",
  robots: { index: false, follow: false },
};

// LeagueMate network: every other manager across your leagues, how many leagues you share, and your real head-to-head
// record against them (from synced matchups). Pure DB read, no Sleeper call.
export default async function LeagueMatesPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <p className="hint">No database configured yet — set <code>DATABASE_URL</code>.</p>
      </section>
    );
  }
  const [accounts, leagueRows, teamRows, myRosters, matchups, results] = await Promise.all([
    db.sleeperAccount.findMany({ select: { id: true } }),
    db.league.findMany({ select: { id: true, name: true, season: true, status: true } }),
    db.leagueRoster.findMany({ select: { leagueId: true, rosterId: true, ownerId: true, teamName: true, wins: true, losses: true, ties: true } }),
    db.roster.findMany({ select: { leagueId: true, rosterId: true } }),
    db.matchup.findMany({ select: { leagueId: true, week: true, myRosterId: true, opponentRosterId: true } }),
    db.weeklyResult.findMany({ select: { leagueId: true, week: true, rosterId: true, won: true, points: true } }),
  ]);
  const resultOf = new Map(results.map((r) => [`${r.leagueId}:${r.week}:${r.rosterId}`, r]));
  const mine = new Set(accounts.map((a) => a.id));
  const myRoster = new Map(myRosters.map((r) => [r.leagueId, r.rosterId]));
  const leagueName = new Map(leagueRows.map((l) => [l.id, l.name]));
  const ownerOf = new Map(teamRows.map((t) => [`${t.leagueId}:${t.rosterId}`, t.ownerId]));

  const byOwner = new Map<string, LeagueMate>();
  const names = new Map<string, Map<string, number>>();
  for (const t of teamRows) {
    if (!t.ownerId || mine.has(t.ownerId) || !myRoster.has(t.leagueId) || myRoster.get(t.leagueId) === t.rosterId) continue;
    const m = byOwner.get(t.ownerId) ?? { ownerId: t.ownerId, name: "", leagues: [], h2hW: 0, h2hL: 0, h2hT: 0, wins: 0, losses: 0 };
    m.leagues.push({ id: t.leagueId, name: leagueName.get(t.leagueId) ?? t.leagueId, record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}` });
    m.wins += t.wins;
    m.losses += t.losses;
    byOwner.set(t.ownerId, m);
    if (t.teamName) {
      const n = names.get(t.ownerId) ?? new Map<string, number>();
      n.set(t.teamName, (n.get(t.teamName) ?? 0) + 1);
      names.set(t.ownerId, n);
    }
  }
  // Real head-to-head: who I played each week (Matchup) and the final result (WeeklyResult, re-read after the week).
  // 0–0 placeholders (a league that hadn't drafted yet) are not results.
  const currentWeek = (await getStateCached())?.week ?? null; // the week being played isn't a result yet
  for (const mu of matchups) {
    if (mu.opponentRosterId == null || (currentWeek != null && mu.week >= currentWeek)) continue;
    const r = resultOf.get(`${mu.leagueId}:${mu.week}:${mu.myRosterId}`);
    const opp = resultOf.get(`${mu.leagueId}:${mu.week}:${mu.opponentRosterId}`);
    if (!r || (r.points === 0 && (opp?.points ?? 0) === 0)) continue;
    const owner = ownerOf.get(`${mu.leagueId}:${mu.opponentRosterId}`);
    const m = owner ? byOwner.get(owner) : undefined;
    if (!m) continue;
    if (r.won === true) m.h2hW++;
    else if (r.won === false) m.h2hL++;
    else m.h2hT++;
  }
  for (const [id, m] of byOwner) {
    const n = names.get(id);
    m.name = n ? [...n.entries()].sort((a, b) => b[1] - a[1])[0][0] : `Manager ${id.slice(-4)}`;
  }
  const mates = [...byOwner.values()].sort((a, b) => b.leagues.length - a.leagues.length || a.name.localeCompare(b.name));
  return <LeagueMates mates={mates} />;
}
