import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import AdminLogin from "@/components/AdminLogin";
import LeagueDetail from "@/components/manager/LeagueDetail";
import { db } from "@/lib/db";
import type { ManagedLeague } from "@/lib/manager";

export const metadata: Metadata = {
  title: "Fantis — Sleeper Manager",
  robots: { index: false, follow: false },
};

export default async function ManagerLeaguePage({
  params,
}: {
  params: Promise<{ leagueId: string }>;
}) {
  const { leagueId } = await params;
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
          <LeagueContent leagueId={leagueId} />
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

async function LeagueContent({ leagueId }: { leagueId: string }) {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Sleeper Manager</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment.
        </p>
      </section>
    );
  }

  const row = await db.league.findUnique({
    where: { id: leagueId },
    include: { account: true },
  });
  if (!row) notFound();

  const league: ManagedLeague = {
    id: row.id,
    accountId: row.accountId,
    accountUsername: row.account.username,
    name: row.name,
    season: row.season,
    totalRosters: row.totalRosters,
    status: row.status,
    settings: row.settings,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
  };

  return <LeagueDetail league={league} />;
}
