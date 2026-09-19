import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// Which of the owner's synced leagues already have this player rostered on
// SOME team — the inverse is "available to add". Reads only the already-
// synced LeagueRoster rows (last sync's snapshot, so a very recent add/drop
// may be stale; Sleeper itself is the final authority when a write is
// attempted). No Sleeper token is involved anywhere in this route.
export async function GET(req: Request) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const playerId = new URL(req.url).searchParams.get("playerId");
  if (!playerId || !/^[A-Za-z0-9]+$/.test(playerId)) {
    return NextResponse.json({ error: "playerId is required." }, { status: 400 });
  }
  const rows = await db.leagueRoster.findMany({
    where: { players: { has: playerId } },
    select: { leagueId: true },
  });
  return NextResponse.json({ rosteredLeagueIds: [...new Set(rows.map((r) => r.leagueId))] });
}
