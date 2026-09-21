import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { describeFormat, parseFormatKey } from "@/lib/fantasyCalcFormat";
import { VALUES_MAX_AGE_MS, ensureFresh, leagueFormats } from "@/lib/fantasyCalcSync";

// Per-league FantasyCalc values, read from OUR database (never from FantasyCalc on
// the request path). Each league is mapped to the closest FantasyCalc format
// (lib/fantasyCalcFormat.ts). Anything stale is refreshed in the background, within
// FantasyCalc's documented limits (lib/fantasyCalcSync.ts). Owner-only like the rest
// of /manager. Data from FantasyCalc.com — show attribution wherever it's displayed.
export const maxDuration = 300;

export async function GET() {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });

  const { byLeague, keys } = await leagueFormats();
  const [rows, fetches] = await Promise.all([
    db.fantasyCalcValue.findMany({
      where: { formatKey: { in: keys }, sleeperId: { not: null } },
      select: { formatKey: true, sleeperId: true, value: true, overallRank: true, positionRank: true, trend30Day: true },
    }),
    db.fantasyCalcFetch.findMany(),
  ]);

  // values[formatKey][sleeperId] = [value, overallRank, positionRank, trend30Day]
  const values: Record<string, Record<string, [number, number, number, number]>> = {};
  for (const r of rows) (values[r.formatKey] ??= {})[r.sleeperId as string] = [r.value, r.overallRank, r.positionRank, r.trend30Day ?? 0];

  const fetchedAt: Record<string, number | null> = {};
  const describe: Record<string, string> = {};
  const now = Date.now();
  const stale: string[] = [];
  for (const k of keys) {
    const f = fetches.find((x) => x.key === k);
    fetchedAt[k] = f?.ok ? f.fetchedAt.getTime() : null;
    const fmt = parseFormatKey(k);
    if (fmt) describe[k] = describeFormat(fmt);
    if (!f || now - f.fetchedAt.getTime() >= VALUES_MAX_AGE_MS) stale.push(k);
  }

  // Refresh after the response is sent. The DB-backed claim guarantees we never
  // exceed FantasyCalc's once-an-hour / once-a-day limits, however often this runs.
  if (stale.length > 0 || !fetches.some((f) => f.key === "players")) after(() => ensureFresh(stale).then(() => undefined));

  return NextResponse.json({
    formats: byLeague,
    describe,
    values,
    fetchedAt,
    refreshing: stale.length > 0,
    attribution: { name: "FantasyCalc", url: "https://fantasycalc.com" },
  });
}
