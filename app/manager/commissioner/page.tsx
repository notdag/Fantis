import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { alertSeverityChipStyle } from "@/lib/manager";
import { IconFlag, IconUsers } from "@/components/manager/MgrIcons";

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

  const alertRows = await db.alert.findMany({
    where: { type: "unclaimed_team", resolvedAt: null },
    include: { league: true },
  });
  // Snoozed alerts stay real/active (visible on the league detail page,
  // which is where snoozing happens) but drop out of this "what needs a
  // commissioner action" view — same filtering spirit as Today's groups.
  const now = new Date();
  const alerts = alertRows.filter((a) => !a.snoozedUntil || a.snoozedUntil <= now);
  const leaguesAffected = new Set(alerts.map((a) => a.leagueId)).size;

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Commissioner</h1>
          <p>
            Real, derived signals only — Sleeper&rsquo;s API doesn&rsquo;t carry payment or
            registration data, so the only commissioner-relevant check is an unclaimed team.
          </p>
        </div>
        {alerts.length > 0 && (
          <div className="mgrstats">
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{ color: "var(--red)", background: "color-mix(in srgb, var(--red) 16%, transparent)" }}
              >
                <IconFlag width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Unclaimed teams</p>
                <p className="mgrstatvalue" style={{ color: "var(--red)" }}>{alerts.length}</p>
              </div>
            </div>
            <div className="mgrstat">
              <div
                className="mgrstaticon"
                style={{ color: "var(--red)", background: "color-mix(in srgb, var(--red) 16%, transparent)" }}
              >
                <IconUsers width={17} height={17} />
              </div>
              <div className="mgrstatbody">
                <p className="mgrstatlabel">Leagues affected</p>
                <p className="mgrstatvalue" style={{ color: "var(--red)" }}>{leaguesAffected}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="sec">
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
    </>
  );
}
