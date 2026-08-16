import type { Metadata } from "next";
import ManagerDashboard from "@/components/manager/ManagerDashboard";
import { db } from "@/lib/db";
import type {
  ManagedAccount,
  ManagedAlert,
  ManagedDraft,
  ManagedLeague,
  ManagedSyncRun,
  ManagedSyncRunError,
} from "@/lib/manager";

// Not linked from the main nav and not indexable — same spirit as /admin.
export const metadata: Metadata = {
  title: "Fantis — Sleeper Manager",
  robots: { index: false, follow: false },
};

export default async function ManagerPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Sleeper Manager</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const [accountRows, leagueRows, lastRunRow, alertRows, draftRows, pingRow, rosterRows] = await Promise.all([
    db.sleeperAccount.findMany({ orderBy: { connectedAt: "asc" } }),
    db.league.findMany({ include: { account: true }, orderBy: { name: "asc" } }),
    db.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    db.alert.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "asc" } }),
    db.draft.findMany(),
    db.automationPing.findUnique({ where: { id: "singleton" } }),
    db.roster.findMany({ select: { wins: true, losses: true, ties: true, fpts: true } }),
  ]);

  const accounts: ManagedAccount[] = accountRows.map((a) => ({
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    connectedAt: a.connectedAt.toISOString(),
    lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
  }));

  const leagues: ManagedLeague[] = leagueRows.map((lg) => ({
    id: lg.id,
    accountId: lg.accountId,
    accountUsername: lg.account.username,
    name: lg.name,
    season: lg.season,
    totalRosters: lg.totalRosters,
    status: lg.status,
    settings: lg.settings,
    lastSyncedAt: lg.lastSyncedAt?.toISOString() ?? null,
  }));

  const lastRun: ManagedSyncRun | null = lastRunRow
    ? {
        id: lastRunRow.id,
        accountId: lastRunRow.accountId,
        startedAt: lastRunRow.startedAt.toISOString(),
        finishedAt: lastRunRow.finishedAt?.toISOString() ?? null,
        status: lastRunRow.status,
        leaguesSeen: lastRunRow.leaguesSeen,
        leaguesOk: lastRunRow.leaguesOk,
        leaguesFailed: lastRunRow.leaguesFailed,
        errors: (lastRunRow.errors as ManagedSyncRunError[] | null) ?? null,
      }
    : null;

  const alertsByLeague: Record<string, ManagedAlert[]> = {};
  for (const a of alertRows) {
    const alert: ManagedAlert = {
      id: a.id,
      type: a.type,
      severity: a.severity as "action_required" | "review",
      message: a.message,
      playerId: a.playerId,
      week: a.week,
      createdAt: a.createdAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString() ?? null,
      snoozedUntil: a.snoozedUntil?.toISOString() ?? null,
    };
    (alertsByLeague[a.leagueId] ??= []).push(alert);
  }

  const draftsByLeague: Record<string, ManagedDraft> = {};
  for (const d of draftRows) {
    draftsByLeague[d.leagueId] = {
      id: d.id,
      status: d.status,
      type: d.type,
      startTime: d.startTime?.toISOString() ?? null,
    };
  }

  return (
    <ManagerDashboard
      accounts={accounts}
      leagues={leagues}
      lastRun={lastRun}
      alertsByLeague={alertsByLeague}
      draftsByLeague={draftsByLeague}
      automationLastPingAt={pingRow?.lastPingAt.toISOString() ?? null}
      rosters={rosterRows}
    />
  );
}
