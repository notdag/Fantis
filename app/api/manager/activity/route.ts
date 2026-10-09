import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { sanitizeLogEntry } from "@/lib/bulkOps";

// Activity log (Command Center 2.0): every scan, plan, approval and execution the manager tools record. Admin-cookie gated
// like every other manager route; nothing here talks to Sleeper.
//   GET  ?from=ISO&to=ISO&leagueId=&tool=&status=&kind=&player=&limit=      → { entries }
//   GET  ?recentKeys=k1,k2&withinMin=30                                       → { sent: [keys executed ok/submitted/uncertain recently] }
//   POST { entries: LogEntry[] } (≤ 500)                                      → { saved }
async function authorized() {
  const store = await cookies();
  return isValidToken(store.get(ADMIN_COOKIE)?.value);
}

export async function GET(req: Request) {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const u = new URL(req.url);
  const recent = u.searchParams.get("recentKeys");
  if (recent !== null) {
    // Duplicate guard across page reloads: which of these exact changes were already sent (or may have been) recently?
    const keys = recent.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 1000);
    const within = Math.min(24 * 60, Math.max(1, Number(u.searchParams.get("withinMin")) || 30));
    if (keys.length === 0) return NextResponse.json({ sent: [] });
    const rows = await db.operationLog.findMany({
      where: { opKey: { in: keys }, kind: "execute", status: { in: ["ok", "submitted", "uncertain", "unverified"] }, at: { gte: new Date(Date.now() - within * 60_000) } },
      select: { opKey: true },
    });
    return NextResponse.json({ sent: [...new Set(rows.map((r) => r.opKey))] });
  }
  const where: Record<string, unknown> = {};
  const from = u.searchParams.get("from");
  const to = u.searchParams.get("to");
  if (from || to) where.at = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
  for (const k of ["leagueId", "tool", "status", "kind"] as const) {
    const v = u.searchParams.get(k);
    if (v) where[k] = v;
  }
  const player = u.searchParams.get("player");
  if (player) where.OR = [{ playerName: { contains: player, mode: "insensitive" } }, { playerId: player }];
  const limit = Math.min(1000, Math.max(1, Number(u.searchParams.get("limit")) || 300));
  const rows = await db.operationLog.findMany({ where, orderBy: { at: "desc" }, take: limit });
  return NextResponse.json({ entries: rows.map((r) => ({ ...r, at: r.at.toISOString() })) });
}

export async function POST(req: Request) {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { entries?: unknown } | null;
  if (!b || !Array.isArray(b.entries) || b.entries.length === 0 || b.entries.length > 500) {
    return NextResponse.json({ error: "Send 1–500 entries." }, { status: 400 });
  }
  const clean = b.entries.map(sanitizeLogEntry).filter((e): e is NonNullable<ReturnType<typeof sanitizeLogEntry>> => !!e);
  if (clean.length === 0) return NextResponse.json({ error: "No valid entries." }, { status: 400 });
  await db.operationLog.createMany({ data: clean });
  return NextResponse.json({ saved: clean.length });
}
