import { NextResponse } from "next/server";
import { isValidAutomationToken } from "@/lib/automationAuth";
import { db } from "@/lib/db";

// POST: the userscript's heartbeat, every ~5s while /manager is open — lets
// the dashboard show a real "connected" status instead of guessing.
export async function POST(req: Request) {
  if (!isValidAutomationToken(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  await db.automationPing.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastPingAt: new Date(), userAgent: req.headers.get("user-agent") },
    update: { lastPingAt: new Date(), userAgent: req.headers.get("user-agent") },
  });

  return NextResponse.json({ ok: true });
}
