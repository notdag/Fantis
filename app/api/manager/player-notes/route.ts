import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// Free-text notes attached to a player — purely informational memory,
// surfaced back in chat rationale. Never parsed or acted on automatically;
// see PlayerPreference's "never_start" kind for an actually-enforced rule.
async function authorized() {
  const store = await cookies();
  return isValidToken(store.get(ADMIN_COOKIE)?.value);
}

export async function GET() {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const rows = await db.playerNote.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json({ notes: Object.fromEntries(rows.map((r) => [r.playerId, r.note])) });
}

// Upserts or deletes ONE player's note (empty note = delete) — unlike
// /preferences, this isn't a full-list replace, since notes are free text
// per player rather than list membership.
export async function PUT(req: Request) {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { playerId?: unknown; note?: unknown } | null;
  const playerId = body?.playerId;
  const note = body?.note;
  if (typeof playerId !== "string" || !/^[A-Za-z0-9]+$/.test(playerId)) {
    return NextResponse.json({ error: "Invalid player id." }, { status: 400 });
  }
  if (typeof note !== "string" || note.length > 2000) {
    return NextResponse.json({ error: "Note must be text, 2000 characters or fewer." }, { status: 400 });
  }
  if (note.trim() === "") {
    await db.playerNote.deleteMany({ where: { playerId } });
    return NextResponse.json({ ok: true, deleted: true });
  }
  await db.playerNote.upsert({
    where: { playerId },
    create: { playerId, note },
    update: { note },
  });
  return NextResponse.json({ ok: true, deleted: false });
}
