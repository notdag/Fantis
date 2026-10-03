import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// POST: snooze (or un-snooze) a real, already-persisted alert. Admin-cookie
// auth, same as every other dashboard-facing /api/manager/* route — this is
// the owner deciding to quiet a specific alert, not the userscript.
// { hours: 0 } clears the snooze; "Dismiss" is just a very long snooze
// (24*365 hours), not a separate mechanism/column.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { hours?: number } | null;
  const hours = body?.hours;
  if (typeof hours !== "number" || hours < 0) {
    return NextResponse.json({ error: "hours must be a non-negative number." }, { status: 400 });
  }

  const alert = await db.alert.findUnique({ where: { id } }).catch(() => null);
  if (!alert) {
    return NextResponse.json({ error: "No such alert." }, { status: 404 });
  }

  await db.alert.update({
    where: { id },
    data: { snoozedUntil: hours === 0 ? null : new Date(Date.now() + hours * 3600000) },
  });

  return NextResponse.json({ ok: true });
}
