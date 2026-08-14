import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import AdminLogin from "@/components/AdminLogin";
import WaiverAssistant from "@/components/manager/WaiverAssistant";
import { db } from "@/lib/db";
import type { WaiverLeague } from "@/components/manager/WaiverAssistant";

export const metadata: Metadata = {
  title: "Fantis — Waiver Assistant",
  robots: { index: false, follow: false },
};

export default async function WaiverPage() {
  const store = await cookies();
  const authed = isValidToken(store.get(ADMIN_COOKIE)?.value);

  return (
    <div className="fantis">
      <div className="wrap">
        <nav className="nav">
          <div className="brand">
            <div className="mark">F</div>
            <b>Fantis</b>
            <span style={{ color: "var(--dim)", fontSize: 12, marginLeft: 6 }}>waiver assistant</span>
          </div>
        </nav>
        {authed ? (
          <WaiverContent />
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

async function WaiverContent() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Waiver Assistant</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const [leagueRows, rosterRows, pingRow] = await Promise.all([
    db.league.findMany({ orderBy: { name: "asc" } }),
    db.roster.findMany(),
    db.automationPing.findUnique({ where: { id: "singleton" } }),
  ]);

  const rosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r]));

  // Only leagues with a synced roster can suggest a drop candidate — a
  // league that hasn't rostered anything yet (e.g. still pre_draft) has
  // nothing to rank.
  const leagues: WaiverLeague[] = leagueRows
    .filter((lg) => rosterByLeague.has(lg.id))
    .map((lg) => {
      const roster = rosterByLeague.get(lg.id)!;
      return {
        leagueId: lg.id,
        leagueName: lg.name,
        players: roster.players,
        starters: roster.starters,
      };
    });

  return (
    <WaiverAssistant
      leagues={leagues}
      automationLastPingAt={pingRow?.lastPingAt.toISOString() ?? null}
    />
  );
}
