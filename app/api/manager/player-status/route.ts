import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { isBestBall } from "@/lib/manager";

// Player Operations (Command Center 2.0): where one player stands in every in-season league, from already-synced data
// only (no Sleeper call): on my roster (starting / bench / IR), on another team (which one), recently dropped (likely
// still on waivers), or free. Admin-cookie gated. It's "as of the last sync" — every send re-reads Sleeper first anyway.
//   GET ?playerId=123 → { leagues: [{ leagueId, leagueName, bestBall, state, detail }] }
const DAY = 86_400_000;

function setting(settings: unknown, key: string): number | null {
  const s = settings as Record<string, unknown> | null;
  const inner = s && typeof s.settings === "object" && s.settings ? (s.settings as Record<string, unknown>) : null;
  const v = inner?.[key] ?? s?.[key];
  return typeof v === "number" ? v : null;
}

export async function GET(req: Request) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const playerId = new URL(req.url).searchParams.get("playerId") ?? "";
  if (!/^\d{1,10}$|^[A-Z]{2,3}$/.test(playerId)) return NextResponse.json({ error: "Bad playerId." }, { status: 400 });

  const leagues = await db.league.findMany({ where: { status: "in_season" }, select: { id: true, name: true, settings: true }, orderBy: { name: "asc" } });
  const ids = leagues.map((l) => l.id);
  const [mine, others, drops] = await Promise.all([
    db.roster.findMany({ where: { leagueId: { in: ids } }, select: { leagueId: true, rosterId: true, players: true, starters: true, reserve: true } }),
    db.leagueRoster.findMany({ where: { leagueId: { in: ids }, players: { has: playerId } }, select: { leagueId: true, rosterId: true, teamName: true } }),
    db.leagueTransaction.findMany({
      where: { leagueId: { in: ids }, status: "complete", createdAt: { gte: new Date(Date.now() - 7 * DAY) } },
      select: { leagueId: true, createdAt: true, drops: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const myByLeague = new Map(mine.map((r) => [r.leagueId, r]));
  const otherByLeague = new Map(others.map((r) => [r.leagueId, r]));
  const droppedAt = new Map<string, number>();
  for (const t of drops) {
    const list = Array.isArray(t.drops) ? (t.drops as { playerId?: string }[]) : [];
    if (list.some((d) => d.playerId === playerId) && !droppedAt.has(t.leagueId)) droppedAt.set(t.leagueId, t.createdAt.getTime());
  }

  const now = Date.now();
  const out = leagues
    .filter((l) => myByLeague.has(l.id))
    .map((l) => {
      const me = myByLeague.get(l.id)!;
      const base = { leagueId: l.id, leagueName: l.name, bestBall: isBestBall(l.settings) };
      if (me.players.includes(playerId)) {
        if (me.reserve.includes(playerId)) return { ...base, state: "MINE_IR", detail: "on your IR" };
        if (me.starters.includes(playerId)) return { ...base, state: "MINE_STARTING", detail: "in your starting lineup" };
        return { ...base, state: "MINE_BENCH", detail: "on your bench" };
      }
      const other = otherByLeague.get(l.id);
      if (other && other.rosterId !== me.rosterId) return { ...base, state: "OTHER_TEAM", detail: other.teamName ? `on ${other.teamName}` : "on another team" };
      const at = droppedAt.get(l.id);
      const clear = setting(l.settings, "waiver_clear_days");
      if (at != null && now - at < (clear ?? 2) * DAY) {
        return { ...base, state: "WAIVER", detail: `dropped ${Math.max(1, Math.round((now - at) / 3_600_000))}h ago — likely still on waivers` };
      }
      return { ...base, state: "FREE", detail: "not on any roster at the last sync" };
    });
  return NextResponse.json({ leagues: out });
}
