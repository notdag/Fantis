import { NextResponse } from "next/server";
import { isValidAutomationToken } from "@/lib/automationAuth";
import { db } from "@/lib/db";

// POST: the userscript reports back after actually attempting the action —
// real completion/failure, not assumed. No automatic retry on failure; the
// dashboard just shows the real error.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isValidAutomationToken(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as
    | { status?: "completed" | "failed"; error?: string }
    | null;
  const status = body?.status;
  if (status !== "completed" && status !== "failed") {
    return NextResponse.json({ error: "status must be completed or failed." }, { status: 400 });
  }

  const action = await db.action.findUnique({ where: { id } }).catch(() => null);
  if (!action) {
    return NextResponse.json({ error: "No such action." }, { status: 404 });
  }

  await db.action.update({
    where: { id },
    data: {
      status,
      completedAt: new Date(),
      error: status === "failed" ? (body?.error ?? "Unknown error") : null,
    },
  });

  return NextResponse.json({ ok: true });
}
