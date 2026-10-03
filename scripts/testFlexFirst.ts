// "Flex first" list tests. Run: npx tsx scripts/testFlexFirst.ts
import { optimizeLineup } from "../lib/lineupOptimizer";
let pass = 0, fail = 0;
const ok = (c: unknown, n: string) => (c ? pass++ : (fail++, console.log("  FAIL ", n)));

type P = { id: string; pos: string; pts: number; day?: "THU" | "SUN" };
function run(players: P[], starters: string[], flex: string[] = []) {
  const by = new Map(players.map((p) => [p.id, p]));
  return optimizeLineup({
    slotCodes: ["WR", "FLEX"],
    starters,
    candidates: players.map((p) => p.id),
    posOf: (id) => by.get(id)?.pos ?? null,
    points: (id) => by.get(id)?.pts ?? 0,
    unavailable: () => false,
    locked: () => false,
    gameDay: (id) => by.get(id)?.day,
    flexFirst: flex.length ? (id) => { const i = flex.indexOf(id); return i < 0 ? undefined : i; } : undefined,
  });
}

// Two equal WRs: the one on the flex list ends up in FLEX, the other in WR.
const eq: P[] = [{ id: "a", pos: "WR", pts: 10 }, { id: "b", pos: "WR", pts: 10 }];
let r = run(eq, ["a", "b"], ["a"]);
ok(r.starters[1] === "a" && r.starters[0] === "b", "flex-first player lands in FLEX, other takes the WR slot");
r = run(eq, ["a", "b"], ["b"]);
ok(r.starters[1] === "b" && r.starters[0] === "a", "works for either player");
// Without the list nothing changes (stay-put).
r = run(eq, ["a", "b"]);
ok(r.changes.length === 0, "no list = no change to an already-set lineup");
// List order decides when both want FLEX.
r = run(eq, ["a", "b"], ["a", "b"]);
ok(r.starters[1] === "a", "earlier in the list wins the single FLEX");
// A real projection edge still beats the tie-break.
const edge: P[] = [{ id: "a", pos: "WR", pts: 10 }, { id: "b", pos: "WR", pts: 10 }, { id: "c", pos: "WR", pts: 12 }];
r = run(edge, ["a", "b"], ["a"]);
ok(r.starters.includes("c") && !r.starters.includes("b"), "better projection still starts (b out, c in)");
// Hard Thu rule still wins: a Thursday WR on the list never goes to FLEX.
const thu: P[] = [{ id: "a", pos: "WR", pts: 10, day: "THU" }, { id: "b", pos: "WR", pts: 10, day: "SUN" }];
r = run(thu, ["a", "b"], ["a"]);
ok(r.starters[0] === "a" && r.starters[1] === "b", "Thursday WR stays out of FLEX even when flex-first");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
