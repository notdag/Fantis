// Run: npx tsx scripts/testKickoffSlot.ts
import { kickoffSlot } from "../lib/kickoffSlot";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

// Real 2026 week-5 kickoffs as ESPN serves them (UTC). October = PDT (UTC-7).
ok(kickoffSlot("2026-10-09T00:15:00Z") === "THU", "Thu 5:15 PM PT (= Fri 00:15 UTC) is THU, not FRI");
ok(kickoffSlot("2026-10-11T13:30:00Z") === "SUN_EARLY", "Sun 6:30 AM PT (London) is SUN_EARLY");
ok(kickoffSlot("2026-10-11T17:00:00Z") === "SUN_EARLY", "Sun 10:00 AM PT is SUN_EARLY");
ok(kickoffSlot("2026-10-11T20:05:00Z") === "SUN_LATE", "Sun 1:05 PM PT is SUN_LATE");
ok(kickoffSlot("2026-10-11T20:25:00Z") === "SUN_LATE", "Sun 1:25 PM PT is SUN_LATE");
ok(kickoffSlot("2026-10-12T00:20:00Z") === "SUN_LATE", "Sun 5:20 PM PT (= Mon 00:20 UTC) is SUN_LATE, not MON");
ok(kickoffSlot("2026-10-13T00:15:00Z") === "MON", "Mon 5:15 PM PT (= Tue 00:15 UTC) is MON, not Tue");
// Week 17 Saturday game: 9:00 PM PT Sat = 04:00 UTC Sunday — must stay SAT (the trap the host-clock version fell into)
ok(kickoffSlot("2027-01-03T04:00:00Z") === "SAT", "Sat 9:00 PM PT (= Sun 04:00 UTC) is SAT, never Sunday");
// Standard-time (winter) offsets
ok(kickoffSlot("2026-12-06T18:00:00Z") === "SUN_EARLY", "Sun 10:00 AM PST (UTC-8) is SUN_EARLY");
ok(kickoffSlot("2026-12-06T21:05:00Z") === "SUN_LATE", "Sun 1:05 PM PST is SUN_LATE");
ok(kickoffSlot("2026-12-02T20:00:00Z") === undefined, "a Wednesday is not a game day");
ok(kickoffSlot(undefined) === undefined && kickoffSlot("garbage") === undefined, "missing / invalid → undefined");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
