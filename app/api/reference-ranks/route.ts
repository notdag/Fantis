import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// PUBLIC, read-only: the Expert / Mason Dodd (Flock Fantasy) reference ranks the site owner
// imported, shown as columns on the public Rankings page. Deliberately separate from
// /api/admin/reference-ranks, which keeps the passphrase-gated write path (upload / clear).
// Short CDN cache: a re-import shows up within a few minutes without hammering the database.
export async function GET() {
  const rows = await db.referenceRank.findMany({ select: { key: true, expert: true, mason: true } });
  const ranks: Record<string, { expert?: number; mason?: number }> = {};
  for (const r of rows) ranks[r.key] = { expert: r.expert ?? undefined, mason: r.mason ?? undefined };
  return NextResponse.json(
    { count: rows.length, ranks },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
