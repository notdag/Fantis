import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { db } from "@/lib/db";

// Outside-source ranks (Flock expert / Mason Dodd) the owner imports from their
// own CSV, shown next to their rankings on the /admin tier board. Display-only.
// Behind the same passphrase cookie as the rest of /admin.
async function authorized() {
  const store = await cookies();
  return isValidToken(store.get(ADMIN_COOKIE)?.value);
}

interface Row {
  key: string;
  name: string;
  pos: string;
  expert: number | null;
  mason: number | null;
}

const rankOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 5000 ? v : null;

export async function GET() {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const rows = await db.referenceRank.findMany();
  return NextResponse.json({ count: rows.length, rows });
}

// An import replaces the whole set in one transaction (the CSV is the full
// source of truth each time — same full-replace approach as the tier board's
// own save), so re-uploading a corrected file never leaves stale rows behind.
export async function PUT(req: NextRequest) {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { rows?: unknown } | null;
  if (!Array.isArray(body?.rows)) return NextResponse.json({ error: "Missing rows." }, { status: 400 });
  if (body.rows.length > 3000) return NextResponse.json({ error: "Too many rows." }, { status: 400 });

  const seen = new Set<string>();
  const clean: Row[] = [];
  for (const r of body.rows as Record<string, unknown>[]) {
    if (!r || typeof r.key !== "string" || typeof r.name !== "string" || typeof r.pos !== "string") {
      return NextResponse.json({ error: "Invalid row." }, { status: 400 });
    }
    if (r.key.length > 160 || r.name.length > 120 || r.pos.length > 6 || seen.has(r.key)) continue;
    const expert = rankOrNull(r.expert);
    const mason = rankOrNull(r.mason);
    if (expert === null && mason === null) continue;
    seen.add(r.key);
    clean.push({ key: r.key, name: r.name, pos: r.pos, expert, mason });
  }
  if (clean.length === 0) return NextResponse.json({ error: "No usable rows." }, { status: 400 });

  await db.$transaction([db.referenceRank.deleteMany(), db.referenceRank.createMany({ data: clean })]);
  return NextResponse.json({ ok: true, count: clean.length });
}

export async function DELETE() {
  if (!(await authorized())) return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  await db.referenceRank.deleteMany();
  return NextResponse.json({ ok: true });
}
