import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { computeFaabStats } from "@/lib/faabHistory";

// Real winning FAAB bids, from already-synced completed waiver claims
// (LeagueTransaction), grouped by league and position — a suggested bid
// based on what actually won recent claims in THAT league, not a guess.
// Read-only, no Sleeper call; owner-only like the rest of /manager.
export async function GET() {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const rows = await db.leagueTransaction.findMany({
    where: { type: "waiver", status: "complete", waiverBid: { not: null } },
    select: { leagueId: true, waiverBid: true, adds: true },
  });
  return NextResponse.json({ stats: computeFaabStats(rows) });
}
