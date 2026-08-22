import type { Metadata } from "next";
import { db } from "@/lib/db";
import { alertSeverityChipStyle } from "@/lib/manager";
import { IconFlag, IconUsers } from "@/components/manager/MgrIcons";
import { PageHead } from "@/components/manager/PageHead";
import { StatCard, StatCardGrid } from "@/components/manager/StatCard";
import { DataTable, TableRow } from "@/components/manager/DataRow";

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
        <PageHead
          description={
            <>
              Real, derived signals only — Sleeper&rsquo;s API doesn&rsquo;t carry payment or
              registration data, so the only commissioner-relevant check is an unclaimed team.
            </>
          }
        />
        {alerts.length > 0 && (
          <StatCardGrid variant="grid">
            <StatCard icon={IconFlag} color="var(--red)" label="Unclaimed teams" value={alerts.length} valueColor="var(--red)" />
            <StatCard icon={IconUsers} color="var(--red)" label="Leagues affected" value={leaguesAffected} valueColor="var(--red)" />
          </StatCardGrid>
        )}
      </section>

      <section className="sec">
        {alerts.length === 0 ? (
          <p className="hint">Every league has a full set of claimed teams.</p>
        ) : (
          <DataTable>
            {alerts.map((a) => (
              <TableRow as="link" href={`/manager/${a.leagueId}`} key={a.id}>
                <span className="tname" style={{ flex: 1 }}>{a.league.name}</span>
                <span className="pos" style={alertSeverityChipStyle("review")}>review</span>
                <span className="portmeta">{a.message}</span>
              </TableRow>
            ))}
          </DataTable>
        )}
      </section>
    </>
  );
}
