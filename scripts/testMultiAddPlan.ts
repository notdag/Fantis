// Tests for the multi-target add planner. Run: npx tsx scripts/testMultiAddPlan.ts
import { buildMultiAddPlan } from "../lib/multiAddPlan";
import type { PlanLeague } from "../lib/bulkPlan";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const RP8 = ["QB", "RB", "WR", "TE", "FLEX", "BN", "BN", "BN"]; // 8 spots
const values: Record<string, number> = { b1: 5, b2: 10, b3: 20, b4: 30 };
const rank = (id: string): [number, number] => [values[id] ?? 0, 0];
const noBid = () => 0;

function lg(id: string, players: string[], starters: string[], reserve: string[] = [], faabUsed: number | null = null, faabSettings: Record<string, unknown> = {}): PlanLeague {
  return {
    leagueId: id,
    leagueName: "League " + id,
    rosterId: 1,
    settings: { roster_positions: RP8, settings: { waiver_type: 0, waiver_bid_min: 0, waiver_budget: 0, ...faabSettings } },
    starters,
    players,
    reserve,
    faabUsed,
  };
}

const rostered = (overrides: Record<string, string[]> = {}): Record<string, ReadonlySet<string>> => ({
  x: new Set(overrides.x ?? []),
  y: new Set(overrides.y ?? []),
  z: new Set(overrides.z ?? []),
});

// ------------------------------------------------------------- open slots first
{
  // Full roster (8/8), two open-slot equivalents: none — everyone gets a drop.
  const full = lg("1", ["s1", "s2", "s3", "s4", "s5", "b1", "b2", "b3"], ["s1", "s2", "s3", "s4", "s5"]);
  const { rows } = buildMultiAddPlan(["x", "y"], [full], rostered(), rank, noBid);
  const byTarget = Object.fromEntries(rows.map((r) => [r.targetId, r]));
  ok(byTarget.x.full && byTarget.y.full, "a full roster requires a drop for every target");
  ok(byTarget.x.dropId === "b1" && byTarget.y.dropId === "b2", "two targets in one full league get DISTINCT drops, weakest first", JSON.stringify([byTarget.x.dropId, byTarget.y.dropId]));
  ok(!byTarget.y.dropCandidates.includes("b1"), "the second target's dropdown excludes the first target's already-claimed drop", byTarget.y.dropCandidates.join());
  ok(byTarget.x.dropCandidates.includes("b1"), "the first target's own dropdown still offers its own current pick");
}

// ------------------------------------------------------------- open slots consumed first
{
  // Roster has 1 open slot (7/8) — the FIRST target in order gets it free; the rest need drops.
  const oneOpen = lg("1", ["s1", "s2", "s3", "s4", "s5", "b1", "b2"], ["s1", "s2", "s3", "s4", "s5"]);
  const { rows } = buildMultiAddPlan(["x", "y", "z"], [oneOpen], rostered(), rank, noBid);
  const byTarget = Object.fromEntries(rows.map((r) => [r.targetId, r]));
  ok(!byTarget.x.full && byTarget.x.dropId === null, "the first target in order takes the one open slot");
  ok(byTarget.y.full && byTarget.y.dropId === "b1", "the second target needs a drop — weakest bench player");
  ok(byTarget.z.full && byTarget.z.dropId === "b2", "the third target gets a distinct drop from the second's", JSON.stringify([byTarget.y.dropId, byTarget.z.dropId]));
}

// ------------------------------------------------------------- three targets, only two droppable bench players
{
  const twoOnBench = lg("1", ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "b1"], ["s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
  const { rows } = buildMultiAddPlan(["x", "y"], [twoOnBench], rostered(), rank, noBid);
  const byTarget = Object.fromEntries(rows.map((r) => [r.targetId, r]));
  ok(byTarget.x.dropId === "b1", "only bench player is claimed by the first target");
  ok(byTarget.y.dropId === null && byTarget.y.dropCandidates.length === 0, "second target with nobody left to drop: no candidate, not a guess", JSON.stringify(byTarget.y));
}

// ------------------------------------------------------------- already rostered / already owned skip
{
  const open = lg("1", ["s1"], ["s1"]);
  const { rows } = buildMultiAddPlan(["x", "y"], [open], rostered({ x: ["1"] }), rank, noBid);
  ok(rows.length === 1 && rows[0].targetId === "y", "a target already rostered somewhere in this league is skipped entirely");
}

// ------------------------------------------------------------- FAAB budget warnings
{
  const faabLeague = lg("1", ["s1", "s2"], ["s1", "s2"], [], 40, { waiver_type: 2, waiver_budget: 100 });
  const bid = (_l: string, t: string) => (t === "x" ? 40 : t === "y" ? 30 : 10);
  const { rows, budgetWarnings } = buildMultiAddPlan(["x", "y", "z"], [faabLeague], rostered(), rank, bid);
  ok(rows.every((r) => r.faab && r.budgetLeft === 60), "FAAB rows carry the real budget left (100 budget - 40 used)");
  ok(budgetWarnings.length === 1 && budgetWarnings[0].totalBid === 80 && budgetWarnings[0].budgetLeft === 60, "combined bids (40+30+10=80) exceed the 60 left → flagged", JSON.stringify(budgetWarnings));
  ok(budgetWarnings[0].targetCount === 3, "warning names how many targets are competing for that budget");

  const underBudget = buildMultiAddPlan(["z"], [faabLeague], rostered(), rank, bid);
  ok(underBudget.budgetWarnings.length === 0, "a single small bid under budget is never flagged");
}

// ------------------------------------------------------------- non-FAAB league never warns
{
  const std = lg("1", ["s1"], ["s1"]);
  const { budgetWarnings } = buildMultiAddPlan(["x", "y"], [std], rostered(), rank, () => 999);
  ok(budgetWarnings.length === 0, "a non-FAAB league is never given a budget warning");
}

// ------------------------------------------------------------- bid never below the league's own minimum
{
  const minLeague = lg("1", ["s1"], ["s1"], [], 0, { waiver_type: 2, waiver_budget: 100, waiver_bid_min: 5 });
  const { rows } = buildMultiAddPlan(["x"], [minLeague], rostered(), rank, () => 1);
  ok(rows[0].bid === 5, "a suggestion below the league's bid minimum is raised to the minimum");
}

// ------------------------------------------------------------- multiple leagues stay independent
{
  const l1 = lg("1", ["s1", "s2", "s3", "s4", "s5", "b1", "b2", "b3"], ["s1", "s2", "s3", "s4", "s5"]);
  const l2 = lg("2", ["s1"], ["s1"]);
  const { rows } = buildMultiAddPlan(["x", "y"], [l1, l2], rostered(), rank, noBid);
  const l1Rows = rows.filter((r) => r.leagueId === "1");
  const l2Rows = rows.filter((r) => r.leagueId === "2");
  ok(l1Rows.every((r) => r.full) && l2Rows.every((r) => !r.full), "drop requirement in one league never leaks into another");
}

// ------------------------------------------------------------- a Priority-listed player is never suggested as a drop
{
  // b1 is the weakest by value (would normally be picked first), but it's on
  // the owner's Priority list — it must never be offered, even as the only
  // remaining candidate for a second target.
  const full = lg("1", ["s1", "s2", "s3", "s4", "s5", "b1", "b2", "b3"], ["s1", "s2", "s3", "s4", "s5"]);
  const { rows } = buildMultiAddPlan(["x", "y"], [full], rostered(), rank, noBid, (id) => id === "b1");
  const byTarget = Object.fromEntries(rows.map((r) => [r.targetId, r]));
  ok(byTarget.x.dropId === "b2", "the Priority-listed weakest player is skipped — the next real candidate is offered instead", byTarget.x.dropId ?? "null");
  ok(!byTarget.x.dropCandidates.includes("b1") && !byTarget.y.dropCandidates.includes("b1"), "the Priority-listed player never appears in either target's dropdown at all", JSON.stringify([byTarget.x.dropCandidates, byTarget.y.dropCandidates]));

  // If EVERY bench player is Priority-listed, there's honestly nothing to
  // propose — never falls back to suggesting a protected player anyway.
  const allProtected = buildMultiAddPlan(["x"], [full], rostered(), rank, noBid, () => true);
  ok(allProtected.rows[0].dropId === null && allProtected.rows[0].dropCandidates.length === 0, "when every real candidate is Priority-protected, nobody is suggested — not even as a last resort", JSON.stringify(allProtected.rows[0]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
