import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// The owner's preferred / avoided players for lineup optimising. Plain
// Sleeper player ids — nothing sensitive, and no Sleeper token is involved.
async function authorized() {
  const store = await cookies();
  return isValidToken(store.get(ADMIN_COOKIE)?.value);
}

export async function GET() {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const rows = await db.playerPreference.findMany({ orderBy: { rank: "asc" } });
  return NextResponse.json({
    priority: rows.filter((r) => r.kind === "priority").map((r) => r.playerId),
    avoid: rows.filter((r) => r.kind === "avoid").map((r) => r.playerId),
  });
}

// Replaces the whole list in one transaction (the UI always sends the full
// ordered lists, same "full replace" approach as the curated-player save).
export async function PUT(req: Request) {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { priority?: unknown; avoid?: unknown } | null;
  const clean = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null;
    const out: string[] = [];
    for (const id of v) {
      if (typeof id !== "string" || !/^[A-Za-z0-9]+$/.test(id)) return null;
      if (!out.includes(id)) out.push(id);
    }
    return out.length <= 500 ? out : null;
  };
  const priority = clean(body?.priority ?? []);
  const avoid = clean(body?.avoid ?? []);
  if (!priority || !avoid) return NextResponse.json({ error: "Invalid lists." }, { status: 400 });

  // A player can't be both — priority wins.
  const avoidOnly = avoid.filter((id) => !priority.includes(id));
  await db.$transaction([
    db.playerPreference.deleteMany({}),
    db.playerPreference.createMany({
      data: [
        ...priority.map((playerId, rank) => ({ playerId, kind: "priority", rank })),
        ...avoidOnly.map((playerId) => ({ playerId, kind: "avoid", rank: 0 })),
      ],
    }),
  ]);
  return NextResponse.json({ ok: true, priority: priority.length, avoid: avoidOnly.length });
}
