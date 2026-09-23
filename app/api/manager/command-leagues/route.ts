import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { isBestBall, slimLeagueSettings } from "@/lib/manager";
import type { CcLeague } from "@/lib/commandCenter/types";

// The league list the floating Command Center AI needs (id, status, slim rules,
// which roster is mine). Read-only, admin-cookie gated, no Sleeper calls. A
// league with no synced roster of mine is left out — never guess which is mine.
export async function GET() {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const [leagues, rosters] = await Promise.all([
    db.league.findMany({
      select: { id: true, accountId: true, name: true, status: true, settings: true },
      orderBy: { name: "asc" },
    }),
    db.roster.findMany({ select: { leagueId: true, rosterId: true } }),
  ]);
  const rosterBy = new Map(rosters.map((r) => [r.leagueId, r.rosterId]));
  const out: CcLeague[] = [];
  for (const l of leagues) {
    const rid = rosterBy.get(l.id);
    if (rid == null) continue;
    const settings = slimLeagueSettings(l.settings);
    out.push({ id: l.id, name: l.name, status: l.status, settings, rosterId: rid, ownerId: l.accountId, bestBall: isBestBall(settings) });
  }
  return NextResponse.json({ leagues: out });
}
