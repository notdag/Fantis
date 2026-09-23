import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { isPermission } from "@/lib/commandCenter/proposals";

// Command Center AI audit trail. Records what was asked and what a READ-ONLY
// scan found — never a change (Phase 1 has none). Admin-cookie gated like every
// other manager route; nothing here talks to Sleeper.
async function authorized() {
  const store = await cookies();
  return isValidToken(store.get(ADMIN_COOKIE)?.value);
}

const int = (v: unknown, max = 1_000_000) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.trunc(v))) : 0);
const strs = (v: unknown, n: number, len: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n).map((s) => s.slice(0, len)) : [];

export async function GET() {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const rows = await db.commandAudit.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json({ entries: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
}

export async function POST(req: Request) {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.command !== "string" || typeof b.intent !== "string") {
    return NextResponse.json({ error: "command and intent are required." }, { status: 400 });
  }
  const players = Array.isArray(b.players)
    ? b.players
        .filter((p): p is { id: string; name: string } => !!p && typeof (p as { id?: unknown }).id === "string" && typeof (p as { name?: unknown }).name === "string")
        .slice(0, 10)
        .map((p) => ({ id: p.id.slice(0, 32), name: p.name.slice(0, 80) }))
    : [];
  const counts = b.counts && typeof b.counts === "object" ? b.counts : null;
  const row = await db.commandAudit.create({
    data: {
      command: b.command.slice(0, 500),
      intent: b.intent.slice(0, 40),
      // The mode the owner had selected when the command ran (chat itself never writes in any mode).
      permission: isPermission(b.permission) ? b.permission : "READ_ONLY",
      players,
      leaguesTotal: int(b.leaguesTotal),
      leaguesScanned: int(b.leaguesScanned),
      leaguesPartial: int(b.leaguesPartial),
      leaguesFailed: int(b.leaguesFailed),
      durationMs: int(b.durationMs, 3_600_000),
      counts: counts ?? undefined,
      actionableLeagues: typeof b.actionableLeagues === "number" ? int(b.actionableLeagues) : null,
      recommendations: strs(b.recommendations, 12, 200),
      errors: strs(b.errors, 25, 200),
      toolCalls: int(b.toolCalls),
    },
  });
  return NextResponse.json({ id: row.id });
}
