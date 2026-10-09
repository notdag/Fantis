// Season forecast for one league (My Team): each team's projected points per remaining week, my win chance each week,
// and a Monte Carlo of the rest of the regular season for playoff / first-round-bye odds.
//
// Inputs are real: every team's current roster and record, the league's real schedule (Sleeper matchup pairings per
// week), Sleeper's season projection per game for each player, and the 2026 bye weeks. Documented simplifications:
//   · a team's weekly projection = its best legal lineup by projection per game, with that week's bye players removed
//     (and, for the current week only, players listed Out/IR/PUP/Sus/Doubtful) — no trades, waivers or injuries ahead;
//   · each game is won with lib/winProb.ts's chance (±20% weekly swing around each projection);
//   · standings rank by wins, then projected points for; playoff_teams make it, and the top 2 get a bye when 6 make it.
import { winProb } from "./winProb";

export interface FcTeam {
  rosterId: number;
  name: string;
  players: string[];
  wins: number;
  losses: number;
  ties: number;
  pf: number;
}

const SLOT_OK: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

// Best lineup points: fill the most restrictive slots first (single position), then flex slots, each time taking the
// highest-projected eligible player not used yet. Exact for standard slot shapes; a close bound for exotic ones.
export function bestLineup(players: string[], slots: string[], ppgOf: (id: string) => number, posOf: (id: string) => string | undefined, available: (id: string) => boolean): { points: number; ids: string[] } {
  const pool = players.filter(available).map((id) => ({ id, pos: posOf(id), v: ppgOf(id) })).filter((p) => p.pos && p.v > 0).sort((a, b) => b.v - a.v);
  const used = new Set<string>();
  const order = [...slots].filter((s) => SLOT_OK[s]).sort((a, b) => SLOT_OK[a].length - SLOT_OK[b].length);
  let points = 0;
  for (const s of order) {
    const pick = pool.find((p) => !used.has(p.id) && SLOT_OK[s].includes(p.pos!));
    if (pick) {
      used.add(pick.id);
      points += pick.v;
    }
  }
  return { points, ids: [...used] };
}
export const bestLineupPoints = (...a: Parameters<typeof bestLineup>) => bestLineup(...a).points;

export interface FcResult {
  playoffPct: number;
  byePct: number;
  expWins: number;
  expLosses: number;
  avgFinish: number;
}

// Deterministic PRNG so the same inputs always print the same odds (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateSeason(opts: {
  teams: FcTeam[];
  schedule: Record<number, [number, number][]>; // week → pairs of rosterIds
  proj: (rosterId: number, week: number) => number;
  playoffTeams: number;
  sims?: number;
}): Map<number, FcResult> {
  const { teams, schedule, proj, playoffTeams } = opts;
  const sims = opts.sims ?? 4000;
  const byes = playoffTeams === 6 ? 2 : 0;
  const weeks = Object.keys(schedule).map(Number).sort((a, b) => a - b);
  const games: { a: number; b: number; pa: number; projA: number; projB: number }[] = [];
  for (const w of weeks)
    for (const [a, b] of schedule[w]) {
      const pa = winProb(proj(a, w), proj(b, w));
      games.push({ a, b, pa: pa ?? 0.5, projA: proj(a, w), projB: proj(b, w) });
    }
  const acc = new Map<number, { po: number; bye: number; w: number; l: number; fin: number }>();
  for (const t of teams) acc.set(t.rosterId, { po: 0, bye: 0, w: 0, l: 0, fin: 0 });
  const r = rng(teams.length * 7919 + games.length);
  for (let s = 0; s < sims; s++) {
    const wins = new Map(teams.map((t) => [t.rosterId, t.wins + t.ties / 2]));
    const pf = new Map(teams.map((t) => [t.rosterId, t.pf]));
    for (const g of games) {
      const aWins = r() < g.pa;
      wins.set(aWins ? g.a : g.b, (wins.get(aWins ? g.a : g.b) ?? 0) + 1);
      pf.set(g.a, (pf.get(g.a) ?? 0) + g.projA);
      pf.set(g.b, (pf.get(g.b) ?? 0) + g.projB);
    }
    const order = [...teams].sort((x, y) => (wins.get(y.rosterId)! - wins.get(x.rosterId)!) || (pf.get(y.rosterId)! - pf.get(x.rosterId)!));
    order.forEach((t, i) => {
      const e = acc.get(t.rosterId)!;
      if (i < playoffTeams) e.po++;
      if (i < byes) e.bye++;
      e.fin += i + 1;
    });
  }
  const out = new Map<number, FcResult>();
  for (const t of teams) {
    const e = acc.get(t.rosterId)!;
    let ew = 0;
    let el = 0;
    for (const g of games) {
      if (g.a === t.rosterId) {
        ew += g.pa;
        el += 1 - g.pa;
      } else if (g.b === t.rosterId) {
        ew += 1 - g.pa;
        el += g.pa;
      }
    }
    out.set(t.rosterId, { playoffPct: e.po / sims, byePct: e.bye / sims, expWins: t.wins + ew, expLosses: t.losses + el, avgFinish: e.fin / sims });
  }
  return out;
}
