import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import { getUser, getState } from "@/lib/sleeper";
import { syncAccount } from "@/lib/managerSync";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

// Connects a Sleeper username: resolves it to a real Sleeper user_id, upserts
// a SleeperAccount row (reconnecting an already-known username is a no-op
// update, not a duplicate), then runs an initial sync for just that account
// so "connect" and "populate leagues" land as one step.
export async function POST(req: Request) {
  const store = await cookies();
  if (!isValidToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { username?: string } | null;
  const username = body?.username?.trim();
  if (!username) {
    return NextResponse.json({ error: "username is required." }, { status: 400 });
  }

  const user = await getUser(username).catch(() => null);
  if (!user || !user.user_id) {
    return NextResponse.json({ error: `Couldn't find a Sleeper user named "${username}".` }, { status: 404 });
  }

  const state = await getState().catch(() => null);
  const season = state?.season ?? new Date().getFullYear().toString();

  await db.sleeperAccount.upsert({
    where: { id: user.user_id },
    create: { id: user.user_id, username, displayName: user.display_name ?? null },
    update: { username, displayName: user.display_name ?? null },
  });

  const run = await db.syncRun.create({
    data: { accountId: user.user_id, status: "running" },
  });

  const result = await syncAccount(user.user_id, season);

  const status = result.fatal ? "failed" : result.leaguesFailed > 0 ? "partial_failure" : "success";
  await db.syncRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      status,
      leaguesSeen: result.leaguesSeen,
      leaguesOk: result.leaguesOk,
      leaguesFailed: result.leaguesFailed,
      errors: (result.fatal
        ? [{ message: result.fatal }]
        : result.errors.length > 0
          ? result.errors
          : undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  if (result.fatal) {
    return NextResponse.json({ error: result.fatal }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    accountId: user.user_id,
    leaguesSeen: result.leaguesSeen,
    leaguesOk: result.leaguesOk,
    leaguesFailed: result.leaguesFailed,
  });
}
