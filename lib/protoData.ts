// Design prototypes (/proto/*) — one server-side read of already-synced data (no Sleeper calls) shaped for the two
// redesign prototypes. Read-only; nothing here writes anywhere.
import { db } from "@/lib/db";
import { isBestBall, rosterPositionsFromSettings, waiverBudget } from "@/lib/manager";
import { irSlots } from "@/lib/bulkPlan";
import { nextWaiverRun } from "@/lib/waiverSchedule";

export interface ProtoLeague {
  id: string;
  name: string;
  tag: string; // "#55" when the name has a number, else initials
  bestBall: boolean;
  wins: number;
  losses: number;
  ties: number;
  pf: number;
  rank: number | null; // standing in the league by record, then points for
  teams: number;
  playoffTeams: number | null;
  week: number | null;
  myPts: number | null;
  oppPts: number | null;
  oppName: string | null;
  myProj: number | null;
  oppProj: number | null;
  injured: number; // injured/out starters (open alerts)
  bye: number; // bye-week starters
  emptySlots: number; // empty starting slots
  openSpots: number; // free active-roster spots (negative = over the limit)
  irUsed: number;
  irTotal: number;
  faabLeft: number | null;
  faabBudget: number | null;
  alerts: number;
  syncedHoursAgo: number | null;
  slots: string[]; // starting slot labels in order (QB, RB, FLEX …)
  starters: string[]; // player ids per slot ("0" = empty)
  bench: string[];
  reserve: string[];
  waiverAt: string | null; // next waiver processing time (ISO), when the league has a schedule
}

export interface ProtoExposure {
  id: string;
  leagues: number;
  starting: number;
}

export interface ProtoAlert {
  id: string;
  leagueId: string;
  leagueName: string;
  type: string;
  severity: string;
  message: string;
  playerId: string | null;
}

export interface ProtoData {
  alerts: ProtoAlert[];
  leagues: ProtoLeague[];
  exposure: ProtoExposure[];
  totalLeagues: number;
  plansWaiting: number;
  season: string;
  generatedAt: string;
}

function inner(settings: unknown, key: string): number | null {
  const s = settings as Record<string, unknown> | null;
  const i = s && typeof s.settings === "object" && s.settings ? (s.settings as Record<string, unknown>) : null;
  const v = i?.[key];
  return typeof v === "number" ? v : null;
}

const tagOf = (name: string) => {
  const m = name.match(/#\s?(\d{1,4})/);
  if (m) return `#${m[1]}`;
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
};

export async function loadProtoData(): Promise<ProtoData> {
  const [leagueRows, rosterRows, leagueRosterRows, matchupRows, alertRows, plansWaiting] = await Promise.all([
    db.league.findMany({ where: { status: "in_season" }, select: { id: true, name: true, season: true, settings: true, lastSyncedAt: true }, orderBy: { name: "asc" } }),
    db.roster.findMany({ select: { leagueId: true, rosterId: true, wins: true, losses: true, ties: true, fpts: true, starters: true, players: true, reserve: true, faabUsed: true } }),
    db.leagueRoster.findMany({ select: { leagueId: true, rosterId: true, wins: true, losses: true, ties: true, fpts: true } }),
    db.matchup.findMany({ select: { leagueId: true, week: true, myPoints: true, opponentPoints: true, opponentTeamName: true, myProjPoints: true, opponentProjPoints: true }, orderBy: { week: "desc" } }),
    db.alert.findMany({ where: { resolvedAt: null }, select: { id: true, leagueId: true, type: true, severity: true, message: true, playerId: true, snoozedUntil: true }, orderBy: { createdAt: "asc" } }),
    db.commandProposal.count({ where: { status: { in: ["proposed", "approved"] } } }),
  ]);
  const totalLeagues = await db.league.count();
  const myRoster = new Map(rosterRows.map((r) => [r.leagueId, r]));
  const teamsBy = new Map<string, typeof leagueRosterRows>();
  for (const r of leagueRosterRows) (teamsBy.get(r.leagueId) ?? teamsBy.set(r.leagueId, []).get(r.leagueId)!).push(r);
  const latest = new Map<string, (typeof matchupRows)[number]>();
  for (const m of matchupRows) if (!latest.has(m.leagueId)) latest.set(m.leagueId, m);
  const nowMs = new Date().getTime();
  const alertsBy = new Map<string, { all: number; inj: number; bye: number }>();
  for (const a of alertRows) {
    if (a.snoozedUntil && a.snoozedUntil.getTime() > nowMs) continue;
    const e = alertsBy.get(a.leagueId) ?? { all: 0, inj: 0, bye: 0 };
    e.all++;
    if (a.type === "injured_starter") e.inj++;
    if (a.type === "bye_starter") e.bye++;
    alertsBy.set(a.leagueId, e);
  }

  const exposure = new Map<string, ProtoExposure>();
  const leagues: ProtoLeague[] = [];
  for (const lg of leagueRows) {
    const me = myRoster.get(lg.id);
    if (!me) continue;
    const bestBall = isBestBall(lg.settings);
    const teams = teamsBy.get(lg.id) ?? [];
    const order = [...teams].sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || (b.fpts ?? 0) - (a.fpts ?? 0));
    const idx = order.findIndex((t) => t.rosterId === me.rosterId);
    const m = latest.get(lg.id);
    const al = alertsBy.get(lg.id) ?? { all: 0, inj: 0, bye: 0 };
    const size = rosterPositionsFromSettings(lg.settings).length;
    const budget = waiverBudget(lg.settings);
    leagues.push({
      id: lg.id,
      name: lg.name,
      tag: tagOf(lg.name),
      bestBall,
      wins: me.wins,
      losses: me.losses,
      ties: me.ties,
      pf: me.fpts ?? 0,
      rank: idx >= 0 ? idx + 1 : null,
      teams: teams.length,
      playoffTeams: inner(lg.settings, "playoff_teams"),
      week: m?.week ?? null,
      myPts: m?.myPoints ?? null,
      oppPts: m?.opponentPoints ?? null,
      oppName: m?.opponentTeamName ?? null,
      myProj: m?.myProjPoints ?? null,
      oppProj: m?.opponentProjPoints ?? null,
      injured: al.inj,
      bye: al.bye,
      emptySlots: me.starters.filter((s) => !s || s === "0").length,
      openSpots: size > 0 ? size - (me.players.length - me.reserve.length) : 0,
      irUsed: me.reserve.length,
      irTotal: irSlots(lg.settings),
      faabLeft: budget == null ? null : Math.max(0, budget - (me.faabUsed ?? 0)),
      faabBudget: budget,
      alerts: al.all,
      syncedHoursAgo: lg.lastSyncedAt ? Math.floor((nowMs - lg.lastSyncedAt.getTime()) / 3_600_000) : null,
      slots: rosterPositionsFromSettings(lg.settings).filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI").slice(0, me.starters.length),
      starters: me.starters,
      bench: me.players.filter((p) => !me.starters.includes(p) && !me.reserve.includes(p)),
      reserve: me.reserve,
      waiverAt: nextWaiverRun(lg.settings, new Date(nowMs))?.at.toISOString() ?? null,
    });
    if (!bestBall) {
      for (const p of me.players) {
        const e = exposure.get(p) ?? { id: p, leagues: 0, starting: 0 };
        e.leagues++;
        if (me.starters.includes(p)) e.starting++;
        exposure.set(p, e);
      }
    }
  }
  const nameOf = new Map(leagueRows.map((l) => [l.id, l.name]));
  const alerts: ProtoAlert[] = alertRows
    .filter((a) => (!a.snoozedUntil || a.snoozedUntil.getTime() <= nowMs) && nameOf.has(a.leagueId))
    .map((a) => ({ id: a.id, leagueId: a.leagueId, leagueName: nameOf.get(a.leagueId)!, type: a.type, severity: a.severity, message: a.message, playerId: a.playerId }));
  return {
    alerts,
    leagues,
    exposure: [...exposure.values()].sort((a, b) => b.leagues - a.leagues).slice(0, 160),
    totalLeagues,
    plansWaiting,
    season: leagueRows[0]?.season ?? String(new Date(nowMs).getFullYear()),
    generatedAt: new Date(nowMs).toISOString(),
  };
}
