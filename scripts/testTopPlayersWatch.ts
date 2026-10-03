// Run: npx tsx scripts/testTopPlayersWatch.ts
import { adaptivePosRanks, findBenchedWatched } from "../lib/topPlayersWatch";
let pass = 0, fail = 0;
const ok = (c: unknown, n: string) => (c ? pass++ : (fail++, console.log("  FAIL ", n)));

const entries = [
  { id: "a", pos: "QB", posRank: 1 },
  { id: "b", pos: "QB", posRank: 2 }, // Out
  { id: "c", pos: "QB", posRank: 3 },
  { id: "d", pos: "RB", posRank: 1 },
];
const out = (id: string) => (id === "b" ? "Out" : null);
const r = adaptivePosRanks(entries, out);
ok(r.get("a") === 1 && r.get("c") === 2, "healthy QBs renumber, skipping the injured one");
ok(!r.has("b"), "injured player gets no rank");
ok(r.get("d") === 1, "other positions are independent");

// With a QB limit of 2, the injured QB2 must not hold a spot: QB3 (adaptive 2) is watched.
const lg = { leagueId: "L", leagueName: "L", slotCodes: ["QB"], starters: ["a"], players: ["a", "b", "c"], reserve: [] };
const res = findBenchedWatched([lg], {
  limits: { QB: 2 },
  posRankOf: (id) => r.get(id),
  rankOrder: (id) => ({ a: 0, b: 1, c: 2 } as Record<string, number>)[id],
  priorityIndex: () => undefined,
  posOf: () => "QB",
  unavailableReason: out,
});
ok(!res.some((x) => x.playerId === "b"), "injured top-N player is not watched/flagged at all");
ok(res.some((x) => x.playerId === "c"), "next healthy player slid into the top-N and is watched");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
