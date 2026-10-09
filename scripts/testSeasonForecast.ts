// Season forecast. Run: npx tsx scripts/testSeasonForecast.ts
import { bestLineupPoints, simulateSeason, type FcTeam } from "../lib/seasonForecast";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

// best lineup: QB, RB, RB, WR, FLEX
const pos: Record<string, string> = { q1: "QB", q2: "QB", r1: "RB", r2: "RB", r3: "RB", w1: "WR", w2: "WR", t1: "TE" };
const v: Record<string, number> = { q1: 20, q2: 15, r1: 15, r2: 12, r3: 11, w1: 14, w2: 9, t1: 10 };
const slots = ["QB", "RB", "RB", "WR", "FLEX"];
const all = Object.keys(pos);
ok(bestLineupPoints(all, slots, (id) => v[id], (id) => pos[id], () => true) === 20 + 15 + 12 + 14 + 11, "fills true slots first, then FLEX with the best leftover");
ok(bestLineupPoints(all, slots, (id) => v[id], (id) => pos[id], (id) => id !== "r1") === 20 + 12 + 11 + 14 + 10, "an unavailable (bye) player is replaced");
ok(bestLineupPoints(["q1"], slots, (id) => v[id], (id) => pos[id], () => true) === 20, "empty slots score nothing — never invented");

// season: a clearly stronger team should usually make the playoffs; odds stay in range
const teams: FcTeam[] = [1, 2, 3, 4].map((id) => ({ rosterId: id, name: `T${id}`, players: [], wins: 2, losses: 2, ties: 0, pf: 400 }));
const strength: Record<number, number> = { 1: 150, 2: 110, 3: 105, 4: 100 };
const schedule: Record<number, [number, number][]> = {};
for (let w = 5; w <= 14; w++) schedule[w] = w % 2 ? [[1, 2], [3, 4]] : [[1, 3], [2, 4]];
const res = simulateSeason({ teams, schedule, proj: (id) => strength[id], playoffTeams: 2, sims: 3000 });
const t1 = res.get(1)!;
const t4 = res.get(4)!;
ok(t1.playoffPct > 0.9, "strongest team almost always makes a 2-team playoff", String(t1.playoffPct));
ok(t4.playoffPct < t1.playoffPct, "weakest team makes it less often");
ok([...res.values()].reduce((s, r) => s + r.playoffPct, 0) > 1.99 && [...res.values()].reduce((s, r) => s + r.playoffPct, 0) < 2.01, "exactly 2 playoff spots handed out per simulation");
ok(Math.abs(t1.expWins + t1.expLosses - 14) < 1e-9, "expected wins + losses = games played + remaining");
const again = simulateSeason({ teams, schedule, proj: (id) => strength[id], playoffTeams: 2, sims: 3000 });
ok(again.get(1)!.playoffPct === t1.playoffPct, "deterministic: same inputs give the same odds");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
