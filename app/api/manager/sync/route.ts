import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { getState } from "@/lib/sleeper";
import { syncAccount, type SyncError } from "@/lib/managerSync";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

// Re-syncs one connected account, or every connected account when
// accountId is omitted (the dashboard's "Sync now" button default). One
// SyncRun row per call, aggregating counts across however many accounts it
// actually touches. 100 leagues at batch-of-10 is comfortably under this —
// the explicit bump exists because Vercel's Hobby default (10s) isn't
// enough headroom regardless.
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
  const season = state?.season ?? new Date().getFullYear().toString();

  const run = await db.syncRun.create({
    data: { accountId: scopedAccountId, status: "running" },
  });

  let leaguesSeen = 0;
  let leaguesOk = 0;
  let leaguesFailed = 0;
  const errors: (SyncError | { message: string })[] = [];

  for (const account of accounts) {
    const result = await syncAccount(account.id, season);
    if (result.fatal) {
      errors.push({ message: `${account.username}: ${result.fatal}` });
      continue;
    }
    leaguesSeen += result.leaguesSeen;
    leaguesOk += result.leaguesOk;
    leaguesFailed += result.leaguesFailed;
    errors.push(...result.errors);
  }

  const status = leaguesSeen === 0 && errors.length > 0
    ? "failed"
    : leaguesFailed > 0 || errors.length > 0
      ? "partial_failure"
      : "success";

  await db.syncRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      status,
      leaguesSeen,
      leaguesOk,
      leaguesFailed,
      errors: (errors.length > 0 ? errors : undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  return NextResponse.json({ ok: true, accountsSynced: accounts.length, leaguesSeen, leaguesOk, leaguesFailed });
}
