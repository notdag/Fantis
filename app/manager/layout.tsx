import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import AdminLogin from "@/components/AdminLogin";
import ManagerShell from "@/components/manager/ManagerShell";
import { db } from "@/lib/db";
import "./manager.css";

// Shared shell for every /manager/* page — auth gate, plus (once authed) the
// sidebar nav shell. Unauthed case keeps the plain centered-card layout
// (shared .fantis/.wrap/.nav classes, also used by the main non-manager
// app) — no sidebar needed before login. Authed case hands off to
// ManagerShell, which owns the sidebar/mobile-drawer/collapse-toggle chrome
// and wraps `children` in the same .wrap class for consistent gutters.
export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const authed = isValidToken(store.get(ADMIN_COOKIE)?.value);

  if (!authed) {
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
          <AdminLogin
            title="Sleeper Manager access"
            description="Owner-only dashboard for managing your real Sleeper leagues. Not for regular visitors."
          />
        </div>
      </div>
    );
  }

  const initialCollapsed = store.get("fantis_mgr_sidebar")?.value === "1";

  // Fetched once here (not per-page) so the header's league switcher and
  // the sidebar's CurrentLeagueNavGroup work identically on every route,
  // including portfolio pages that don't otherwise touch League/SyncRun.
  const [leagueRows, lastRun] = await Promise.all([
    db.league.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);

  return (
    <div className="fantis">
      <ManagerShell
        initialCollapsed={initialCollapsed}
        leagues={leagueRows}
        lastSyncedAt={lastRun?.finishedAt?.toISOString() ?? null}
      >
        {children}
      </ManagerShell>
    </div>
  );
}
