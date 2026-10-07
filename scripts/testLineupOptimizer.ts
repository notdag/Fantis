// Direct unit tests for lib/lineupOptimizer.ts's day-of-week FLEX rule
// (Thu/Fri/Sat RB/WR can never occupy a FLEX-type slot; among close calls,
// earlier-locking days prefer their own true slot) — requested explicitly
// by the owner, who runs this across 200+ real leagues and wanted it
// "double and triple checked" before trusting it. Run: npx tsx
// scripts/testLineupOptimizer.ts
import { optimizeLineup, type OptimizeInput } from "../lib/lineupOptimizer";

let pass = 0;
let fail = 0;
function ok(cond: unknown, name: string, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

type Player = { id: string; pos: string; pts: number; day?: "THU" | "FRI" | "SAT" | "SUN" | "MON" };

function run(
  slotCodes: string[],
  starters: string[],
  players: Player[],
  opts: { gameDay?: boolean; lockedIds?: Set<string>; neverStartIds?: Set<string> } = { gameDay: true }
) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const input: OptimizeInput = {
    slotCodes,
    starters,
    candidates: players.map((p) => p.id),
    posOf: (id) => byId.get(id)?.pos ?? null,
    points: (id) => byId.get(id)?.pts ?? 0,
    unavailable: () => false,
    // A "locked" (game-started) player freezes his current slot exactly the
    // way a real kicked-off game does — used here to pin one occupant in
    // place so a test can isolate what happens to the REMAINING slot,
    // without the solver reshuffling the pinned player elsewhere.
    locked: (id) => !!opts.lockedIds?.has(id),
    gameDay: opts.gameDay === false ? undefined : (id) => byId.get(id)?.day,
    neverStart: opts.neverStartIds ? (id) => !!opts.neverStartIds?.has(id) : undefined,
  };
  return optimizeLineup(input);
}

async function main() {
  // ---------- 1. A Thursday RB who'd otherwise be the best FLEX pick is
  // never placed in FLEX — he goes to his true RB slot instead (which is
  // open here), bumping the weaker Sunday RB who was there down to FLEX.
  {
    const slots = ["QB", "RB", "WR", "FLEX"];
    const players: Player[] = [
      { id: "qb", pos: "QB", pts: 20 },
      { id: "wr1", pos: "WR", pts: 15 },
      { id: "rbSunLow", pos: "RB", pts: 10, day: "SUN" },
      { id: "rbThuHigh", pos: "RB", pts: 18, day: "THU" },
    ];
    const res = run(slots, ["qb", "0", "wr1", "0"], players);
    const rbSlot = slots.indexOf("RB");
    const flexSlot = slots.indexOf("FLEX");
    ok(res.starters[rbSlot] === "rbThuHigh", "the Thursday RB (higher points) takes the true RB slot", res.starters[rbSlot]);
    ok(res.starters[flexSlot] === "rbSunLow", "the Sunday RB fills FLEX instead — never the Thursday player", res.starters[flexSlot]);
  }

  // ---------- 2. A Thursday RB with genuinely no way into the lineup except
  // FLEX is NEVER placed there even though he outscores the only other
  // FLEX-legal candidate by a wide margin — the real Monday player fills
  // FLEX instead, at a LOWER projection. The true RB slot is locked
  // (game already started) so there's no reshuffle escape hatch — FLEX is
  // truly the only slot in contention here.
  {
    const slots = ["RB", "FLEX"];
    const players: Player[] = [
      { id: "rbTrue", pos: "RB", pts: 30, day: "SUN" },
      { id: "rbThuBest", pos: "RB", pts: 20, day: "THU" }, // outscores wrMonWeak by 12 points
      { id: "wrMonWeak", pos: "WR", pts: 8, day: "MON" },
    ];
    const res = run(slots, ["rbTrue", "0"], players, { lockedIds: new Set(["rbTrue"]) });
    const flexSlot = slots.indexOf("FLEX");
    ok(res.starters[flexSlot] !== "rbThuBest", "the Thursday RB is never placed in FLEX, even outscoring the only legal alternative by 12 points", res.starters[flexSlot]);
    ok(res.starters[flexSlot] === "wrMonWeak", "the real Monday player fills FLEX instead, even at a lower projection", res.starters[flexSlot]);
    ok(!res.starters.includes("rbThuBest"), "the Thursday RB sits on the bench rather than ever entering FLEX", JSON.stringify(res.starters));
  }

  // ---------- 3. Friday and Saturday RB/WR are blocked from FLEX the same
  // way as Thursday (not just a Thursday-only special case).
  for (const day of ["FRI", "SAT"] as const) {
    const slots = ["RB", "WR", "FLEX"];
    const players: Player[] = [
      { id: "rb1", pos: "RB", pts: 20, day: "SUN" },
      { id: "wr1", pos: "WR", pts: 18, day: "SUN" },
      { id: "wrEarly", pos: "WR", pts: 30, day }, // huge points edge, still blocked from FLEX
      { id: "rbMon", pos: "RB", pts: 5, day: "MON" },
    ];
    const res = run(slots, ["rb1", "wr1", "0"], players);
    const flexSlot = slots.indexOf("FLEX");
    ok(res.starters[flexSlot] !== "wrEarly", `a ${day} WR is never placed in FLEX regardless of point edge`, res.starters[flexSlot]);
  }

  // ---------- 4. Sunday and Monday RB/WR are completely unrestricted in
  // FLEX — the baseline, unrestricted case. All-WR (no RB cross-eligibility)
  // so there's only one possible optimal arrangement to check against.
  {
    const slots = ["WR", "FLEX"];
    const players: Player[] = [
      { id: "wr1", pos: "WR", pts: 10, day: "SUN" },
      { id: "wrHigh", pos: "WR", pts: 20, day: "SUN" },
    ];
    const res = run(slots, ["wr1", "0"], players);
    const flexSlot = slots.indexOf("FLEX");
    ok(res.starters[flexSlot] === "wrHigh", "a Sunday player fills FLEX normally, on points alone", res.starters[flexSlot]);
  }

  // ---------- 5. The hard block covers RB/WR/TE (the owner: "flexs should never have
  // Thu–Sat games"); a QB is deliberately exempt so a 2-QB league's superflex is
  // never starved. The true TE/QB slot is locked (game already started) so the
  // Thursday player's ONLY path into the lineup would be the flex slot.
  {
    const slots = ["TE", "REC_FLEX"]; // REC_FLEX = WR/TE
    const players: Player[] = [
      { id: "teBest", pos: "TE", pts: 20, day: "SUN" },
      { id: "teThuBest", pos: "TE", pts: 15, day: "THU" },
      { id: "wr1", pos: "WR", pts: 5, day: "SUN" },
    ];
    const res = run(slots, ["teBest", "0"], players, { lockedIds: new Set(["teBest"]) });
    const flexSlot = slots.indexOf("REC_FLEX");
    ok(res.starters[flexSlot] === "wr1", "a Thursday TE is NOT allowed in a flex slot — the lower-projected Sunday WR takes it instead", res.starters[flexSlot]);
  }
  {
    const slots = ["QB", "SUPER_FLEX"];
    const players: Player[] = [
      { id: "qbBest", pos: "QB", pts: 25, day: "SUN" },
      { id: "qbThuBest", pos: "QB", pts: 15, day: "THU" },
      { id: "rb1", pos: "RB", pts: 5, day: "SUN" },
    ];
    const res = run(slots, ["qbBest", "0"], players, { lockedIds: new Set(["qbBest"]) });
    const flexSlot = slots.indexOf("SUPER_FLEX");
    ok(res.starters[flexSlot] === "qbThuBest", "a Thursday QB is still allowed in superflex — QBs are exempt from the flex block", res.starters[flexSlot]);
  }

  // ---------- 6. Tie-break ordering: among genuinely equal-projection RB/WR
  // competing for one true slot + one FLEX (no hard block in play, since
  // only one is early enough to matter here — Sunday vs Monday), the
  // earlier-locking day prefers the true slot, the later day prefers FLEX.
  {
    const slots = ["WR", "FLEX"];
    const players: Player[] = [
      { id: "wrSun", pos: "WR", pts: 12, day: "SUN" },
      { id: "wrMon", pos: "WR", pts: 12, day: "MON" }, // exactly tied on points
    ];
    const res = run(slots, ["0", "0"], players);
    const wrSlot = slots.indexOf("WR");
    const flexSlot = slots.indexOf("FLEX");
    ok(res.starters[wrSlot] === "wrSun", "on a genuine tie, the Sunday player (locks earlier) takes the true WR slot", res.starters[wrSlot]);
    ok(res.starters[flexSlot] === "wrMon", "...and the Monday player (locks last) takes FLEX, keeping the latest decision in the flexible slot", res.starters[flexSlot]);
  }
  {
    // Same idea across the full Thu > Fri > Sat gradient for the true-slot
    // race itself (two early-week RBs, one true RB slot, no FLEX involved).
    const slots = ["RB"];
    const players: Player[] = [
      { id: "rbFri", pos: "RB", pts: 14, day: "FRI" },
      { id: "rbSat", pos: "RB", pts: 14, day: "SAT" },
    ];
    const res = run(slots, ["0"], players);
    ok(res.starters[0] === "rbFri", "on a genuine tie between two early-week players, Friday (earlier) wins the true slot over Saturday", res.starters[0]);
  }

  // ---------- 7. A real point difference always wins WHO starts, even
  // against a day bias working the other way. One true slot, two
  // candidates: wrHigh has a tiny (0.1) real point edge but is Monday
  // (biased AWAY from a true slot) against wrLow, who is Sunday (neutral).
  // If the bias could override real points, the lower-scoring Sunday
  // player would win the slot instead — it doesn't.
  {
    const slots = ["WR"];
    const players: Player[] = [
      { id: "wrHigh", pos: "WR", pts: 10.1, day: "MON" },
      { id: "wrLow", pos: "WR", pts: 10.0, day: "SUN" },
    ];
    const res = run(slots, ["0"], players);
    ok(res.starters[0] === "wrHigh", "a real (if tiny) point edge still wins the slot even against a day bias pulling the other way", res.starters[0]);
  }

  // ---------- 8. Omitting gameDay entirely (existing callers who don't pass
  // it) reproduces the original, day-unaware behavior exactly — no hard
  // block, no bias, pure points. Regression guard for every caller that
  // hasn't been updated.
  {
    const slots = ["RB", "WR", "FLEX"];
    const players: Player[] = [
      { id: "rb1", pos: "RB", pts: 10 },
      { id: "wr1", pos: "WR", pts: 10 },
      { id: "wrThuBest", pos: "WR", pts: 20, day: "THU" },
    ];
    const res = run(slots, ["rb1", "wr1", "0"], players, { gameDay: false });
    const flexSlot = slots.indexOf("FLEX");
    ok(res.starters[flexSlot] === "wrThuBest", "without gameDay supplied at all, a Thursday player can still fill FLEX on pure points — no silent restriction", res.starters[flexSlot]);
  }

  // ---------- 9. Never proposes a worse lineup than the current one, even
  // when the hard block makes the "ideal" placement impossible — a Thursday
  // RB already correctly sitting in his true slot (not FLEX) is left alone,
  // never swapped out to something worse just to satisfy the rule.
  {
    const slots = ["RB", "FLEX"];
    const players: Player[] = [
      { id: "rbThu", pos: "RB", pts: 20, day: "THU" },
      { id: "wrBench", pos: "WR", pts: 5, day: "SUN" },
    ];
    const res = run(slots, ["rbThu", "0"], players);
    ok(res.starters[0] === "rbThu", "a Thursday RB already correctly in his true slot stays there", res.starters[0]);
    ok(res.changes.length === 1 && res.changes[0].in === "wrBench", "only the genuinely empty FLEX slot gets filled — no pointless churn", JSON.stringify(res.changes));
  }

  // ---------- 9b. A CURRENT lineup that already breaks the flex rule (Thursday player in FLEX, e.g. carried over from this
  // week) is NOT protected by the "never worse" net — the rule wins even though the compliant lineup projects lower.
  {
    const slots = ["RB", "FLEX"];
    const players: Player[] = [
      { id: "rb1", pos: "RB", pts: 10, day: "SUN_EARLY" as never },
      { id: "rbThuBig", pos: "RB", pts: 25, day: "THU" },
      { id: "wrSun", pos: "WR", pts: 6, day: "SUN_LATE" as never },
    ];
    // rb1 is locked in the RB slot (his game started), so the Thursday RB's only way in is FLEX — and that is what the rule forbids
    const res = run(slots, ["rb1", "rbThuBig"], players, { lockedIds: new Set(["rb1"]) });
    ok(res.starters[1] === "wrSun", "a Thursday RB already in FLEX is moved out even though the Sunday WR projects far lower", res.starters.join());
    ok(res.changes.some((c) => c.slotCode === "FLEX" && c.out === "rbThuBig" && c.in === "wrSun"), "…and the change is reported as that swap", JSON.stringify(res.changes));
    ok(res.gain < 0, "the (honest) projected cost is shown as negative gain, not hidden", String(res.gain));
  }
  {
    // nobody else eligible: the FLEX goes EMPTY rather than keeping the Thursday player (never silently breaks the rule)
    const slots = ["RB", "FLEX"];
    const players: Player[] = [
      { id: "rb1", pos: "RB", pts: 10, day: "SUN_EARLY" as never },
      { id: "rbThuBig", pos: "RB", pts: 25, day: "THU" },
    ];
    const res = run(slots, ["rb1", "rbThuBig"], players, { lockedIds: new Set(["rb1"]) });
    ok(res.starters[1] === "0", "no compliant player available → FLEX is left empty, not given to the Thursday game", res.starters.join());
  }
  {
    // a LOCKED (already-played) Thursday player in FLEX can't be moved — never touched
    const slots = ["RB", "FLEX"];
    const players: Player[] = [
      { id: "rb1", pos: "RB", pts: 10, day: "SUN_EARLY" as never },
      { id: "rbThuBig", pos: "RB", pts: 25, day: "THU" },
      { id: "wrSun", pos: "WR", pts: 6, day: "SUN_LATE" as never },
    ];
    const res = run(slots, ["rb1", "rbThuBig"], players, { lockedIds: new Set(["rbThuBig"]) });
    ok(res.starters[1] === "rbThuBig", "a locked slot is never touched, even when it breaks the rule", res.starters.join());
  }

  // ---------- 10. neverStart is a genuine hard exclude — never proposed as
  // a starter even as the only real candidate for an otherwise-empty slot;
  // the slot is left empty rather than starting him.
  {
    const slots = ["WR"];
    const players: Player[] = [{ id: "wrBanned", pos: "WR", pts: 30 }];
    const res = run(slots, ["0"], players, { gameDay: false, neverStartIds: new Set(["wrBanned"]) });
    ok(res.starters[0] === "0", "a hard-excluded player is never started, even with no other real candidate for the slot", res.starters[0]);
  }

  // ---------- 11. neverStart correctly benches a player already sitting in
  // the CURRENT lineup — and the "never propose a worse lineup" safety net
  // does not block his removal, even when there's nobody better to replace
  // him with (the slot goes empty, which is still the correct outcome).
  {
    const slots = ["WR"];
    const players: Player[] = [{ id: "wrBanned", pos: "WR", pts: 30 }];
    const res = run(slots, ["wrBanned"], players, { gameDay: false, neverStartIds: new Set(["wrBanned"]) });
    ok(res.starters[0] === "0", "a hard-excluded player already started is benched, not left in place", res.starters[0]);
    ok(res.changes.length === 1 && res.changes[0].out === "wrBanned" && res.changes[0].in === null, "the change is reported honestly as a removal with nothing to replace him", JSON.stringify(res.changes));
  }

  // ---------- 12. neverStart doesn't affect anyone else — a real, better
  // replacement still gets the slot normally.
  {
    const slots = ["WR"];
    const players: Player[] = [
      { id: "wrBanned", pos: "WR", pts: 30 },
      { id: "wrOk", pos: "WR", pts: 10 },
    ];
    const res = run(slots, ["wrBanned"], players, { gameDay: false, neverStartIds: new Set(["wrBanned"]) });
    ok(res.starters[0] === "wrOk", "a real, unbanned replacement takes the slot instead of leaving it empty", res.starters[0]);
  }

  // ---------- 8. Early vs late Sunday: with identical projections the 10 AM PT game takes the TRUE slot and the later
  // Sunday game takes FLEX; Monday also prefers FLEX; a real projection edge still wins over the preference.
  {
    const slots = ["WR", "FLEX"];
    const early: Player[] = [
      { id: "early", pos: "WR", pts: 12, day: "SUN_EARLY" as never },
      { id: "late", pos: "WR", pts: 12, day: "SUN_LATE" as never },
    ];
    // start them in the "wrong" slots so only the preference can move them
    let res = run(slots, ["late", "early"], early);
    ok(res.starters[0] === "early" && res.starters[1] === "late", "equal projections: early-Sunday player takes the WR slot, late-Sunday player takes FLEX", res.starters.join());
    res = run(slots, ["early", "late"], early);
    ok(res.changes.length === 0, "already early→WR / late→FLEX: nothing to change");
    const mon: Player[] = [
      { id: "early", pos: "WR", pts: 12, day: "SUN_EARLY" as never },
      { id: "mon", pos: "WR", pts: 12, day: "MON" },
    ];
    res = run(slots, ["mon", "early"], mon);
    ok(res.starters[0] === "early" && res.starters[1] === "mon", "equal projections: Monday player prefers FLEX over an early-Sunday player", res.starters.join());
    const edge: Player[] = [
      { id: "early", pos: "WR", pts: 12, day: "SUN_EARLY" as never },
      { id: "lateBig", pos: "WR", pts: 15, day: "SUN_LATE" as never },
      { id: "benchEarly", pos: "WR", pts: 11.9, day: "SUN_EARLY" as never },
    ];
    res = run(slots, ["early", "benchEarly"], edge);
    ok(res.starters.includes("lateBig") && !res.starters.includes("benchEarly"), "a real projection edge (3 pts) still beats the early-Sunday preference", res.starters.join());
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
