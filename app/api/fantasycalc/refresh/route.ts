import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { ensureFresh, leagueFormats } from "@/lib/fantasyCalcSync";

// Owner-triggered refresh of the stored FantasyCalc data. Safe to press as often as
// you like: FantasyCalc is only actually called when its documented limits allow
// (hourly per format, daily for the player list) — otherwise a format comes back "fresh".
export const maxDuration = 300;

export async function POST() {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { keys } = await leagueFormats();
  const results = await ensureFresh(keys);
  return NextResponse.json({
    formats: keys.length,
    refreshed: results.filter((r) => r.status === "refreshed").length,
    alreadyFresh: results.filter((r) => r.status === "fresh").length,
    failed: results.filter((r) => r.status === "failed").map((r) => ({ key: r.key, error: r.error })),
  });
}
