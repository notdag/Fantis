// Manual lineup picks + tier mode. Run: npx tsx scripts/testLineupEdit.ts
import { applyPick, diffLineups, slotLocked, slotOptions, type EditCtx } from "../lib/lineupEdit";
import { optimizeLineup } from "../lib/lineupOptimizer";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const pos: Record<string, string> = { qb1: "QB", rb1: "RB", rb2: "RB", rb3: "RB", wr1: "WR", wr2: "WR", wr3: "WR", wr4: "WR", te1: "TE", out1: "WR", ban: "WR", lock: "WR" };
const slots = ["QB", "RB", "WR", "WR", "FLEX"];
const base: EditCtx = {
  slotCodes: slots,
  candidates: Object.keys(pos),
  posOf: (id) => pos[id] ?? null,
  unavailable: (id) => id === "out1",
  locked: (id) => id === "lock",
  neverStart: (id) => id === "ban",
};
// lineup: QB qb1, RB rb1, WR wr1, WR wr2, FLEX rb2
const L = ["qb1", "rb1", "wr1", "wr2", "rb2"];

// bench player into FLEX
let r = applyPick(base, L, 4, "wr3");
ok(r && r[4] === "wr3" && r[0] === "qb1" && !r.includes("rb2"), "bench WR into FLEX, displaced RB goes to the bench");
// swap two starters: put rb1 (RB slot) <-> rb2 (FLEX) by picking rb1 for FLEX
r = applyPick(base, L, 4, "rb1");
ok(r && r[4] === "rb1" && r[1] === "rb2", "picking a current starter swaps the two slots (rb2 → RB, rb1 → FLEX)");
// swap invalid: wr1 into FLEX is fine, displaced rb2 would need to fit WR slot -> not eligible
r = applyPick(base, L, 4, "wr1");
ok(r === null, "swap refused when the displaced RB can't take the WR slot");
// ineligible position
ok(applyPick(base, L, 0, "rb3") === null, "an RB can't be picked for QB");
// hard rules
ok(applyPick(base, L, 4, "out1") === null, "an Out/bye player can never be picked");
ok(applyPick(base, L, 4, "ban") === null, "a never-start player can never be picked");
ok(applyPick(base, L, 4, "lock") === null, "a player whose game has started can't be moved in");
ok(applyPick(base, L, 4, "nobody") === null, "a player not on the roster is refused");
// locked slot can't change
const lockedCtx: EditCtx = { ...base, locked: (id) => id === "wr2" };
ok(slotLocked(lockedCtx, L, 3) === true && applyPick(lockedCtx, L, 3, "wr3") === null, "a slot whose occupant's game started can't be changed");
ok(slotOptions(lockedCtx, L, 3).length === 0, "locked slot offers no options");
// swap blocked by a locked slot on the other side
ok(applyPick({ ...base, locked: (id) => id === "rb1" }, L, 4, "rb1") === null, "can't pull a locked starter out of his slot");
// options for FLEX: current + legal bench/starter swaps only
const opts = slotOptions(base, L, 4).sort();
ok(opts.includes("rb2") && opts.includes("rb3") && opts.includes("wr3") && opts.includes("wr4") && opts.includes("te1"), "FLEX options include current, bench RB/WR/TE", opts.join(","));
ok(!opts.includes("out1") && !opts.includes("ban") && !opts.includes("lock") && !opts.includes("qb1"), "FLEX options exclude out/never-start/locked/QB");
ok(!opts.includes("wr1") && !opts.includes("wr2"), "starting WRs excluded from FLEX when the displaced RB can't take a WR slot");
// diff
const d = diffLineups(slots, L, ["qb1", "rb1", "wr1", "wr2", "wr3"]);
ok(d.length === 1 && d[0].slotCode === "FLEX" && d[0].out === "rb2" && d[0].in === "wr3", "diff reports exactly the changed slot");
ok(diffLineups(slots, L, L).length === 0, "no changes → empty diff");

// ── tier mode: the owner's tier decides, projection breaks ties WITHIN a tier ──
// weights come from optimizeLineup's rankOrder band; tier mode passes (tier-1)*100 as the order.
const tier: Record<string, number> = { a: 2, b: 2, c: 1 }; // c is the better tier but projects lowest
const pts: Record<string, number> = { a: 10, b: 14, c: 6 };
const run = (rankOrder?: (id: string) => number | undefined, starters = ["0"]) =>
  optimizeLineup({
    slotCodes: ["WR"],
    starters,
    candidates: ["a", "b", "c"],
    posOf: () => "WR",
    points: (id) => pts[id],
    unavailable: () => false,
    locked: () => false,
    rankOrder,
  });
const tierOrder = (id: string) => (tier[id] !== undefined ? (tier[id] - 1) * 100 : undefined);
ok(run(tierOrder).starters[0] === "c", "tier mode: the better TIER starts even with the lowest projection");
const sameTier = optimizeLineup({ slotCodes: ["WR"], starters: ["0"], candidates: ["a", "b"], posOf: () => "WR", points: (id) => pts[id], unavailable: () => false, locked: () => false, rankOrder: tierOrder });
ok(sameTier.starters[0] === "b", "tier mode: two players in the SAME tier → higher projection wins (b over a)");
const strict = optimizeLineup({ slotCodes: ["WR"], starters: ["0"], candidates: ["a", "b"], posOf: () => "WR", points: (id) => pts[id], unavailable: () => false, locked: () => false, rankOrder: (id) => (id === "a" ? 0 : 1) });
ok(strict.starters[0] === "a", "contrast: strict rank order picks the higher-listed player even when he projects lower");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
