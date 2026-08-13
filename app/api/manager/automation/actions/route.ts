import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { isValidAutomationToken } from "@/lib/automationAuth";
import { db } from "@/lib/db";

// GET: the userscript polls this for pending work (automation-token auth —
// this call comes from the browser session running the script, not the
// logged-in dashboard).
export async function GET(req: Request) {
  if (!isValidAutomationToken(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const actions = await db.action.findMany({
    where: { status: "pending" },
    select: { id: true, targetUrl: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ actions });
}

// POST: the dashboard queues a new action (admin-cookie auth — the owner is
// the one clicking "Open via automation").
export async function POST(req: Request) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { leagueId?: string } | null;
  const leagueId = body?.leagueId;
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId is required." }, { status: 400 });
  }

  const league = await db.league.findUnique({ where: { id: leagueId } });
  if (!league) {
    return NextResponse.json({ error: "No such league." }, { status: 404 });
  }

  const action = await db.action.create({
    data: {
      leagueId,
      type: "open_league",
      status: "pending",
      targetUrl: `https://sleeper.com/leagues/${leagueId}`,
    },
  });

  return NextResponse.json({ ok: true, actionId: action.id });
}
