import type { Metadata } from "next";
import WaiverAssistant from "@/components/manager/WaiverAssistant";
import { db } from "@/lib/db";
import { isBestBall, rosterPositionsFromSettings, slimLeagueSettings, waiverBudget, type ManagedLeague } from "@/lib/manager";
import type { WaiverLeague, FaabLeague } from "@/components/manager/WaiverAssistant";
import type { LineupLeague } from "@/components/manager/LineupManager";

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

  // Scoped to leagues you're actually managing right now — in-season and
  // not best ball (best-ball leagues set their own lineups and don't run
  // real waivers the same way). Same filter Lineups/Open Spots already use.
  const [leagueRows, rosterRows, leagueRosterRows, waiverHistoryRows] = await Promise.all([
    db.league.findMany({
      where: { status: "in_season" },
      select: {
        id: true,
        accountId: true,
        name: true,
        season: true,
        totalRosters: true,
        status: true,
        settings: true,
        group: true,
        lastSyncedAt: true,
        account: { select: { username: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.roster.findMany(),
    db.leagueRoster.findMany({ select: { leagueId: true, players: true } }),
    db.waiverHistory.findMany({ orderBy: [{ season: "desc" }, { leagueName: "asc" }] }),
  ]);

  // Grouped by season for display — a real, on-demand sync (see the
  // Waivers page's own "Sync waiver history" action), not the main Refresh
  // button; empty until that's run at least once. Past-season data, so it's
  // untouched by the in-season/best-ball filtering above.
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

  const scoped = leagueRows.filter((lg) => !isBestBall(lg.settings) && rosterByLeague.has(lg.id));

  // Only leagues with a synced roster can suggest a drop candidate — a
  // league that hasn't rostered anything yet (e.g. still pre_draft) has
  // nothing to rank.
  const leagues: WaiverLeague[] = scoped.map((lg) => {
    const roster = rosterByLeague.get(lg.id)!;
    return {
      leagueId: lg.id,
      leagueName: lg.name,
      rosterId: roster.rosterId,
      players: roster.players,
      starters: roster.starters,
      allRosteredPlayers: Array.from(rosteredByLeague.get(lg.id) ?? []),
      waiverPosition: roster.waiverPosition,
      faabUsed: roster.faabUsed,
    };
  });

  // Real FAAB remaining, per league — budget (this league's own real
  // waiver_budget, only when it's actually FAAB-type) minus faabUsed
  // (already synced from Sleeper's real roster data). Leagues that aren't
  // FAAB at all are left out entirely rather than shown as "$0 left".
  const faabLeagues: FaabLeague[] = scoped
    .map((lg) => {
      const budget = waiverBudget(lg.settings);
      if (budget == null) return null;
      const used = rosterByLeague.get(lg.id)!.faabUsed ?? 0;
      return { leagueId: lg.id, leagueName: lg.name, budget, used, remaining: Math.max(0, budget - used) };
    })
    .filter((l): l is FaabLeague => l !== null)
    .sort((a, b) => a.remaining - b.remaining);

  // Same LineupLeague shape Open Spots/Lineups build, so this page can hand
  // the exact same, already-working multi-target add board (BulkAdd) its
  // data — no new write path, just another view onto the same real leagues.
  const multiAddLeagues: LineupLeague[] = scoped.map((lg) => {
    const r = rosterByLeague.get(lg.id)!;
    const league: ManagedLeague = {
      id: lg.id,
      accountId: lg.accountId,
      accountUsername: lg.account.username,
      name: lg.name,
      season: lg.season,
      totalRosters: lg.totalRosters,
      status: lg.status,
      settings: slimLeagueSettings(lg.settings),
      group: lg.group,
      lastSyncedAt: lg.lastSyncedAt?.toISOString() ?? null,
    };
    return {
      league,
      roster: {
        leagueId: r.leagueId,
        rosterId: r.rosterId,
        starters: r.starters,
        players: r.players,
        reserve: r.reserve,
        waiverPosition: r.waiverPosition,
        faabUsed: r.faabUsed,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        fpts: r.fpts,
        fptsAgainst: r.fptsAgainst,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
      },
      rosterPositions: rosterPositionsFromSettings(lg.settings),
      alertCount: 0,
    };
  });

  return (
    <WaiverAssistant
      leagues={leagues}
      multiAddLeagues={multiAddLeagues}
      faabLeagues={faabLeagues}
      waiverHistoryBySeason={waiverHistoryBySeason}
    />
  );
}
