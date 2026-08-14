import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ADMIN_COOKIE, isValidToken } from "@/lib/adminAuth";
import AdminLogin from "@/components/AdminLogin";
import { db } from "@/lib/db";
import { alertSeverityChipStyle } from "@/lib/manager";

export const metadata: Metadata = {
  title: "Fantis — Commissioner",
  robots: { index: false, follow: false },
};

export default async function CommissionerPage() {
  const store = await cookies();
  const authed = isValidToken(store.get(ADMIN_COOKIE)?.value);

  return (
    <div className="fantis">
      <div className="wrap">
        <nav className="nav">
          <div className="brand">
            <div className="mark">F</div>
            <b>Fantis</b>
            <span style={{ color: "var(--dim)", fontSize: 12, marginLeft: 6 }}>commissioner</span>
          </div>
        </nav>
        {authed ? (
          <CommissionerContent />
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

async function CommissionerContent() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Commissioner</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const alerts = await db.alert.findMany({
    where: { type: "unclaimed_team" },
    include: { league: true },
  });

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Commissioner</h2>
        <Link href="/manager" className="link">
          ← Sleeper Manager
        </Link>
      </div>
      <p className="hint">
        Real, derived signals only — Sleeper&rsquo;s API doesn&rsquo;t carry payment or
        registration data, so the only commissioner-relevant check is an unclaimed team.
      </p>

      {alerts.length === 0 ? (
        <p className="hint" style={{ marginTop: 12 }}>Every league has a full set of claimed teams.</p>
      ) : (
        <div className="portoverview" style={{ marginTop: 12 }}>
          {alerts.map((a) => (
            <Link href={`/manager/${a.leagueId}`} className="portoverviewrow" key={a.id}>
              <span className="tname">{a.league.name}</span>
              <span className="pos" style={alertSeverityChipStyle("review")}>review</span>
              <span className="portmeta">{a.message}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
