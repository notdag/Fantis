import type { Metadata } from "next";
import WaiverAssistant from "@/components/manager/WaiverAssistant";
import { db } from "@/lib/db";
import type { WaiverLeague } from "@/components/manager/WaiverAssistant";

export const metadata: Metadata = {
  title: "Fantis — Waiver Assistant",
  robots: { index: false, follow: false },
};

export default async function WaiverPage() {
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
