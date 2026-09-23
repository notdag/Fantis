import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { computePosRanks } from "@/lib/players";
import { db } from "@/lib/db";

interface IncomingPlayer {
  name: string;
  pos: string;
  team: string;
  tier: number;
}

// The tier board always sends the full ordered board (see
// components/TierBoard.tsx's save()), never a partial diff, so a save is a
// full replace of RankedPlayer in one transaction — same effect
// generatePlayersData() used to have on lib/players.data.ts, just against
// the DB instead of a file. This is what makes the write actually apply on
// the next page load in production, where Vercel's read-only filesystem
// used to force handing back generated source to paste in by hand.
export async function POST(req: NextRequest) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { players?: IncomingPlayer[] } | null;
  const players = body?.players;
  if (!players || !players.length) {
    return NextResponse.json({ error: "Missing players." }, { status: 400 });
  }

  const posRanks = computePosRanks(players);

  await db.$transaction([
    db.rankedPlayer.deleteMany(),
    db.rankedPlayer.createMany({
      data: players.map((p, i) => ({
        order: i,
        name: p.name,
        pos: p.pos,
        team: p.team,
        tier: p.tier,
        posRank: posRanks[i],
      })),
    }),
  ]);

  return NextResponse.json({ ok: true });
}
