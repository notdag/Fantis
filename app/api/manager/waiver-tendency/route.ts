import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { waiverBudget } from "@/lib/manager";

// League bidding tendencies (StatChasers' "League Tendency Analysis"): from this league's own completed FAAB claims
// (LeagueTransaction.waiverBid, already synced) — average and highest winning bid as % of the budget, claims per week,
// how many managers actually bid, and each manager's style. DB-only; admin-cookie gated.
//   GET ?leagueId=… → { budget, claims, weeks, avgPct, maxPct, perWeek, bidders, teams, managers: [...] }
export async function GET(req: Request) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const leagueId = new URL(req.url).searchParams.get("leagueId") ?? "";
  if (!/^\d{5,25}$/.test(leagueId)) return NextResponse.json({ error: "Bad leagueId." }, { status: 400 });
  const [league, txns, teams] = await Promise.all([
    db.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    db.leagueTransaction.findMany({ where: { leagueId, type: "waiver", status: "complete", waiverBid: { not: null } }, select: { week: true, waiverBid: true, rosterIds: true, creatorTeamName: true } }),
    db.leagueRoster.findMany({ where: { leagueId }, select: { rosterId: true, teamName: true } }),
  ]);
  const budget = waiverBudget(league?.settings);
  if (!budget) return NextResponse.json({ budget: null, claims: 0, teams: teams.length, managers: [] });
  const nameOf = new Map(teams.map((t) => [t.rosterId, t.teamName]));
  const by = new Map<number, { name: string; bids: number[] }>();
  for (const t of txns) {
    const rid = t.rosterIds[0];
    if (rid == null) continue;
    const e = by.get(rid) ?? { name: nameOf.get(rid) ?? t.creatorTeamName ?? `Team ${rid}`, bids: [] };
    e.bids.push(((t.waiverBid ?? 0) / budget) * 100);
    by.set(rid, e);
  }
  const all = txns.map((t) => ((t.waiverBid ?? 0) / budget) * 100);
  const weeks = new Set(txns.map((t) => t.week)).size;
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const managers = [...by.values()]
    .map((m) => {
      const a = avg(m.bids);
      return { name: m.name, claims: m.bids.length, avgPct: a, maxPct: Math.max(...m.bids), style: a >= 25 ? "Aggressive" : a >= 8 ? "Balanced" : "Conservative" };
    })
    .sort((x, y) => y.avgPct - x.avgPct);
  return NextResponse.json({
    budget,
    claims: txns.length,
    weeks,
    avgPct: avg(all),
    maxPct: all.length ? Math.max(...all) : 0,
    perWeek: weeks ? txns.length / weeks : 0,
    bidders: managers.length,
    teams: teams.length,
    managers,
  });
}
