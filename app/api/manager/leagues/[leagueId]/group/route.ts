import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// POST: set (or clear) a league's group label. Admin-cookie auth, same as
// every other dashboard-facing /api/manager/* route. This is Fantis's own
// data — never sent to Sleeper, never read from it (see the `group` field
// comment in prisma/schema.prisma).
export async function POST(req: Request, { params }: { params: Promise<{ leagueId: string }> }) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const { leagueId } = await params;
  const body = (await req.json().catch(() => null)) as { group?: string | null } | null;
  if (body === null || body.group === undefined) {
    return NextResponse.json({ error: "group is required (string or null)." }, { status: 400 });
  }
  const trimmed = typeof body.group === "string" ? body.group.trim() : null;

  const league = await db.league.findUnique({ where: { id: leagueId } }).catch(() => null);
  if (!league) {
    return NextResponse.json({ error: "No such league." }, { status: 404 });
  }

  await db.league.update({
    where: { id: leagueId },
    data: { group: trimmed || null },
  });

  return NextResponse.json({ ok: true, group: trimmed || null });
}
