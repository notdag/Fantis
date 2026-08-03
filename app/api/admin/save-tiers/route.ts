import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import fs from "fs/promises";
import path from "path";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { computePosRanks } from "@/lib/players";
import { generatePlayersData } from "@/lib/generatePlayersData";

interface IncomingPlayer {
  name: string;
  pos: string;
  team: string;
  tier: number;
}

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
  const source = generatePlayersData(
    players.map((p, i) => ({ ...p, posRank: posRanks[i] }))
  );

  // Vercel (and most serverless hosts) run a read-only filesystem in
  // production, and a write there wouldn't survive the next deploy anyway —
  // hand back the generated source instead so the owner can paste it into
  // lib/players.data.ts and commit it like any other code change.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: true, written: false, source });
  }

  const filePath = path.join(process.cwd(), "lib", "players.data.ts");
  await fs.writeFile(filePath, source, "utf8");
  return NextResponse.json({ ok: true, written: true });
}
