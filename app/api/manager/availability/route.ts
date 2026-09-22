import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// Which of the owner's synced leagues already have a player rostered on SOME
// team — the inverse is "available to add". Reads only the already-synced
// LeagueRoster rows (last sync's snapshot, so a very recent add/drop may be
// stale; Sleeper itself is the final authority when a write is attempted).
// No Sleeper token is involved anywhere in this route.
//
// `playerIds` (comma-separated, up to 25) does the same lookup for several
// players in one request — the multi-target add board's shape — and returns
// a map instead of one flat list. `playerId` (singular) is kept for the
// original single-target caller.
export async function GET(req: Request) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const url = new URL(req.url);
  const multi = url.searchParams.get("playerIds");
  if (multi != null) {
    const ids = [...new Set(multi.split(",").map((s) => s.trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > 25 || !ids.every((id) => /^[A-Za-z0-9]+$/.test(id))) {
      return NextResponse.json({ error: "playerIds must be 1-25 valid player ids." }, { status: 400 });
    }
    const rows = await db.leagueRoster.findMany({
      where: { players: { hasSome: ids } },
      select: { leagueId: true, players: true },
    });
    const byPlayer: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
    for (const r of rows) {
      for (const id of ids) {
        if (r.players.includes(id)) byPlayer[id].push(r.leagueId);
      }
    }
    for (const id of ids) byPlayer[id] = [...new Set(byPlayer[id])];
    return NextResponse.json({ rosteredLeagueIdsByPlayer: byPlayer });
  }

  const playerId = url.searchParams.get("playerId");
  if (!playerId || !/^[A-Za-z0-9]+$/.test(playerId)) {
    return NextResponse.json({ error: "playerId is required." }, { status: 400 });
  }
  const rows = await db.leagueRoster.findMany({
    where: { players: { has: playerId } },
    select: { leagueId: true },
  });
  return NextResponse.json({ rosteredLeagueIds: [...new Set(rows.map((r) => r.leagueId))] });
}
