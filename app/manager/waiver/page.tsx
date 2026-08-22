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

  const [leagueRows, rosterRows, leagueRosterRows, pingRow, waiverHistoryRows] = await Promise.all([
    db.league.findMany({ orderBy: { name: "asc" } }),
    db.roster.findMany(),
    db.leagueRoster.findMany({ select: { leagueId: true, players: true } }),
    db.automationPing.findUnique({ where: { id: "singleton" } }),
    db.waiverHistory.findMany({ orderBy: [{ season: "desc" }, { leagueName: "asc" }] }),
  ]);

  // Grouped by season for display — a real, on-demand sync (see the
  // Waivers page's own "Sync waiver history" action), not the main Refresh
  // button; empty until that's run at least once.
  const waiverHistoryBySeason: Record<string, { leagueName: string; waiverPosition: number | null; faabUsed: number | null }[]> = {};
  for (const w of waiverHistoryRows) {
    (waiverHistoryBySeason[w.season] ??= []).push({
      leagueName: w.leagueName,
      waiverPosition: w.waiverPosition,
      faabUsed: w.faabUsed,
    });
  }

  const rosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r]));

  // Every real player rostered by ANY team in the league — not just mine —
  // so "is this player actually available" is a true league-wide check
  // instead of only "not on my roster." Zero extra Sleeper calls: this is
  // the same LeagueRoster data the sync loop already gets for free from
  // getRosters().
  const rosteredByLeague = new Map<string, Set<string>>();
  for (const r of leagueRosterRows) {
    const set = rosteredByLeague.get(r.leagueId) ?? new Set<string>();
    for (const id of r.players) set.add(id);
    rosteredByLeague.set(r.leagueId, set);
  }

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
        allRosteredPlayers: Array.from(rosteredByLeague.get(lg.id) ?? []),
        waiverPosition: roster.waiverPosition,
        faabUsed: roster.faabUsed,
      };
    });

  return (
    <WaiverAssistant
      leagues={leagues}
      automationLastPingAt={pingRow?.lastPingAt.toISOString() ?? null}
      waiverHistoryBySeason={waiverHistoryBySeason}
    />
  );
}
