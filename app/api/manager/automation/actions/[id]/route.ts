import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// GET: the dashboard polls one action's status after queuing it (admin-
// cookie auth, same boundary as creating the action).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const { id } = await params;
  const action = await db.action.findUnique({
    where: { id },
    select: { id: true, status: true, error: true },
  });
  if (!action) {
    return NextResponse.json({ error: "No such action." }, { status: 404 });
  }
  return NextResponse.json({ action });
}
