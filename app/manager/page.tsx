import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import AdminLogin from "@/components/AdminLogin";
import ManagerDashboard from "@/components/manager/ManagerDashboard";
import { db } from "@/lib/db";
import type { ManagedAccount, ManagedLeague, ManagedSyncRun } from "@/lib/manager";

// Not linked from the main nav and not indexable — same spirit as /admin.
export const metadata: Metadata = {
  title: "Fantis — Sleeper Manager",
  robots: { index: false, follow: false },
};

export default async function ManagerPage() {
  const store = await cookies();
  const authed = isValidToken(store.get(ADMIN_COOKIE)?.value);

  return (
    <div className="fantis">
      <div className="wrap">
        <nav className="nav">
          <div className="brand">
            <div className="mark">F</div>
            <b>Fantis</b>
            <span style={{ color: "var(--dim)", fontSize: 12, marginLeft: 6 }}>sleeper manager</span>
          </div>
        </nav>
        {authed ? (
          <ManagerContent />
        ) : (
          <AdminLogin
            title="Sleeper Manager access"
            description="Owner-only dashboard for managing your real Sleeper leagues. Not for regular visitors."
          />
        )}
      </div>
    </div>
  );
}

async function ManagerContent() {
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

  const [accountRows, leagueRows, lastRunRow] = await Promise.all([
    db.sleeperAccount.findMany({ orderBy: { connectedAt: "asc" } }),
    db.league.findMany({ include: { account: true }, orderBy: { name: "asc" } }),
    db.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
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
      }
    : null;

  return <ManagerDashboard accounts={accounts} leagues={leagues} lastRun={lastRun} />;
}
