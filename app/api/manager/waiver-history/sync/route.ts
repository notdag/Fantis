import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { getState } from "@/lib/sleeper";
import { syncWaiverHistory } from "@/lib/managerWaiverHistorySync";
import { db } from "@/lib/db";

// Separate, on-demand action (a button on the Waivers page) — deliberately
// not folded into the main /api/manager/sync route. See
// lib/managerWaiverHistorySync.ts for why: the main sync already runs ~100
// leagues at a 60s budget for the current season alone.
export const maxDuration = 60;

export async function POST(req: Request) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { accountId?: string };
  const scopedAccountId = body.accountId ?? null;

  const accounts = scopedAccountId
    ? await db.sleeperAccount.findMany({ where: { id: scopedAccountId } })
    : await db.sleeperAccount.findMany();

  if (accounts.length === 0) {
    return NextResponse.json({ error: "No connected Sleeper account found." }, { status: 404 });
  }

  const state = await getState().catch(() => null);
  const currentSeason = state?.season ?? new Date().getFullYear().toString();

  let seasonsSeen = 0;
  let leaguesSeen = 0;
  let leaguesOk = 0;
  let leaguesFailed = 0;

  for (const account of accounts) {
    const result = await syncWaiverHistory(account.id, currentSeason);
    seasonsSeen += result.seasonsSeen;
    leaguesSeen += result.leaguesSeen;
    leaguesOk += result.leaguesOk;
    leaguesFailed += result.leaguesFailed;
  }

  return NextResponse.json({ ok: true, accountsSynced: accounts.length, seasonsSeen, leaguesSeen, leaguesOk, leaguesFailed });
}
