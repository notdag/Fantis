import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { canTransition, sanitizeDraft, type ProposalStatus } from "@/lib/commandCenter/proposals";

const STATUSES: ProposalStatus[] = ["proposed", "approved", "rejected", "expired", "executing", "executed", "submitted", "failed", "verify_failed"];

// Moves ONE proposal along its legal state machine and appends an event. The
// server refuses illegal moves (for instance anything → "executing" that isn't
// "approved", or "executed" without going through "executing"), and the only
// editable field is the FAAB bid of a not-yet-approved add.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { status?: unknown; message?: unknown; bid?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  const row = await db.commandProposal.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  const current = row.status as ProposalStatus;
  const events = Array.isArray(row.events) ? (row.events as object[]) : [];
  const message = typeof body.message === "string" ? body.message.slice(0, 400) : "";

  // Bid edit (only while still "proposed").
  if (body.bid !== undefined && body.status === undefined) {
    if (current !== "proposed") return NextResponse.json({ error: "The bid can only change before approval." }, { status: 409 });
    if (row.kind !== "ADD" || typeof body.bid !== "number" || !Number.isFinite(body.bid)) return NextResponse.json({ error: "Invalid bid." }, { status: 400 });
    const params = { ...(row.params as Record<string, unknown>), bid: Math.max(0, Math.min(10000, Math.trunc(body.bid))) };
    const check = sanitizeDraft({ kind: row.kind, leagueId: row.leagueId, rosterId: row.rosterId, params });
    if (!check) return NextResponse.json({ error: "Invalid proposal." }, { status: 400 });
    const updated = await db.commandProposal.update({ where: { id }, data: { params: check.params as object, events: [...events, { at: Date.now(), status: current, message: `Bid set to $${(check.params as { bid: number }).bid}` }] } });
    return NextResponse.json({ id: updated.id, status: updated.status });
  }

  const next = body.status as ProposalStatus;
  if (!STATUSES.includes(next)) return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  if (!canTransition(current, next)) {
    return NextResponse.json({ error: `Can't go from ${current} to ${next}.` }, { status: 409 });
  }
  const updated = await db.commandProposal.update({
    where: { id },
    data: { status: next, events: [...events, { at: Date.now(), status: next, message: message || next }] },
  });
  return NextResponse.json({ id: updated.id, status: updated.status });
}
