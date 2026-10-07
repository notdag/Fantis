import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Player } from "@/lib/types";

// The curated player list — real, DB-backed (see RankedPlayer in
// prisma/schema.prisma), read by every component that used to statically
// import lib/players.ts's PLAYERS array. No auth: this is the same data
// that was already shipped in full inside the client JS bundle before this
// moved to the DB, so an unauthenticated read doesn't change what's
// exposed. Writes stay owner-only via /api/admin/save-tiers.
export async function GET() {
  const rows = await db.rankedPlayer.findMany({ orderBy: { order: "asc" } });
  const players: Player[] = rows.map((r) => ({
    name: r.name,
    pos: r.pos,
    team: r.team,
    tier: r.tier,
    posRank: r.posRank,
  }));
  return NextResponse.json(players);
}
