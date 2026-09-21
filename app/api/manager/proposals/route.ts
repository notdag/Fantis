import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";
import { draftKey, sanitizeDraft, type ProposalStatus } from "@/lib/commandCenter/proposals";

// Command Center proposals. Admin-cookie gated like every manager route. This
// route only RECORDS proposals — it never talks to Sleeper and never sees the
// Sleeper login token; execution happens in the owner's browser.
async function authorized() {
  const store = await cookies();
  return isValidToken(store.get(ADMIN_COOKIE)?.value);
}

export async function GET() {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const rows = await db.commandProposal.findMany({ orderBy: { createdAt: "desc" }, take: 400 });
  return NextResponse.json({
    proposals: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      leagueId: r.leagueId,
      leagueName: r.leagueName,
      rosterId: r.rosterId,
      params: r.params,
      rationale: r.rationale,
      origin: r.origin,
      command: r.command,
      status: r.status,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
      events: r.events,
    })),
  });
}

// Body: { drafts: ProposalDraft[] }. Human-origin drafts always start as
// "proposed" — never approved. Only a trusted auto rule (origin "auto") may create
// an already-approved proposal, and it records that in its event log.
export async function POST(req: Request) {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { drafts?: unknown } | null;
  if (!body || !Array.isArray(body.drafts) || body.drafts.length === 0 || body.drafts.length > 300) {
    return NextResponse.json({ error: "Send 1–300 drafts." }, { status: 400 });
  }
  const drafts = body.drafts.map(sanitizeDraft);
  if (drafts.some((d) => d === null)) return NextResponse.json({ error: "One or more drafts were malformed." }, { status: 400 });

  const clean = drafts as NonNullable<(typeof drafts)[number]>[];
  const keys = clean.map(draftKey);
  // Don't queue the same change twice while an earlier copy is still live.
  const existing = await db.commandProposal.findMany({
    where: { dedupeKey: { in: keys }, status: { in: ["proposed", "approved", "executing"] } },
    select: { dedupeKey: true },
  });
  const live = new Set(existing.map((e) => e.dedupeKey));
  const created: string[] = [];
  let duplicates = 0;
  for (let i = 0; i < clean.length; i++) {
    if (live.has(keys[i])) {
      duplicates++;
      continue;
    }
    live.add(keys[i]);
    const d = clean[i];
    const now = Date.now();
    const status: ProposalStatus = d.origin === "auto" ? "approved" : "proposed";
    const events = [
      { at: now, status: "proposed", message: d.origin === "auto" ? `Created by trusted auto rule: ${d.command}` : `Proposed from chat: ${d.command}` },
      ...(status === "approved" ? [{ at: now, status: "approved", message: "Approved by the auto rule that created it (rule only covers IR/PUP → open IR slot)" }] : []),
    ];
    const row = await db.commandProposal.create({
      data: {
        kind: d.kind,
        leagueId: d.leagueId,
        leagueName: d.leagueName,
        rosterId: d.rosterId,
        params: d.params as object,
        rationale: d.rationale,
        origin: d.origin,
        command: d.command,
        status,
        dedupeKey: keys[i],
        events,
      },
    });
    created.push(row.id);
  }
  return NextResponse.json({ created, duplicates });
}
