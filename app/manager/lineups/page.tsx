import type { Metadata } from "next";
import LineupManager from "@/components/manager/LineupManager";
import { db } from "@/lib/db";
import { getState, currentProjectionWeek } from "@/lib/sleeper";
import { rosterPositionsFromSettings, type ManagedLeague } from "@/lib/manager";
import type { LineupLeague } from "@/components/manager/LineupManager";

export const metadata: Metadata = {
  title: "Fantis — Lineups",
  robots: { index: false, follow: false },
};

export default async function LineupsPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <section className="sec">
        <h2>Lineups</h2>
        <p className="hint">
          No database configured yet — set <code>DATABASE_URL</code> in your environment to use
          Sleeper Manager. See <code>.env.example</code>.
        </p>
      </section>
    );
  }

  const [leagueRows, rosterRows, alertRows, state] = await Promise.all([
    db.league.findMany({
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
    // Same "any unresolved alert = needs attention" signal ActionQueue.tsx
    // already uses — no new alert-type assumptions.
    db.alert.findMany({ where: { resolvedAt: null } }),
    getState().catch(() => null),
  ]);

  const rosterByLeague = new Map(rosterRows.map((r) => [r.leagueId, r]));
  const alertCountByLeague = new Map<string, number>();
  for (const a of alertRows) {
    alertCountByLeague.set(a.leagueId, (alertCountByLeague.get(a.leagueId) ?? 0) + 1);
  }

  const currentWeek = state ? currentProjectionWeek(state) : 1;

  const leagues: LineupLeague[] = leagueRows.map((lg) => {
    const league: ManagedLeague = {
      id: lg.id,
      accountId: lg.accountId,
      accountUsername: lg.account.username,
      name: lg.name,
      season: lg.season,
      totalRosters: lg.totalRosters,
      status: lg.status,
      settings: lg.settings,
      group: lg.group,
      lastSyncedAt: lg.lastSyncedAt?.toISOString() ?? null,
    };
    const r = rosterByLeague.get(lg.id);
    return {
      league,
      roster: r
        ? {
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
          }
        : null,
      rosterPositions: rosterPositionsFromSettings(lg.settings),
      alertCount: alertCountByLeague.get(lg.id) ?? 0,
    };
  });

  return <LineupManager leagues={leagues} currentWeek={currentWeek} season={state?.season ?? new Date().getFullYear().toString()} />;
}
