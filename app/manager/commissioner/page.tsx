import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { alertSeverityChipStyle } from "@/lib/manager";

export const metadata: Metadata = {
  title: "Fantis — Commissioner",
  robots: { index: false, follow: false },
};

export default async function CommissionerPage() {
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
      <div className="mgrhead">
        <div className="mgraccentbar" />
        <h1>Commissioner</h1>
        <p>
          Real, derived signals only — Sleeper&rsquo;s API doesn&rsquo;t carry payment or
          registration data, so the only commissioner-relevant check is an unclaimed team.
        </p>
      </div>

      {alerts.length === 0 ? (
        <p className="hint">Every league has a full set of claimed teams.</p>
      ) : (
        <div className="mgrtable">
          {alerts.map((a) => (
            <Link href={`/manager/${a.leagueId}`} className="mgrrow" key={a.id}>
              <span className="tname" style={{ flex: 1 }}>{a.league.name}</span>
              <span className="pos" style={alertSeverityChipStyle("review")}>review</span>
              <span className="portmeta">{a.message}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
