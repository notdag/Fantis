// Run: npx tsx scripts/testWaiverSchedule.ts
import { formatCountdown, nextWaiverRun } from "../lib/waiverSchedule";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));
const L = (inner: Record<string, number>) => ({ settings: inner });

// dow=2 (Wednesday), hr=0 → Wed 00:00 Pacific. In October (PDT, UTC-7) that is 07:00 UTC.
// Real data: processed claims landed Wed ~07:05-07:15 UTC for exactly these settings.
const wedMidnight = L({ waiver_day_of_week: 2, daily_waivers_hour: 0, daily_waivers: 0 });
let r = nextWaiverRun(wedMidnight, new Date("2026-10-05T12:00:00Z")); // Mon Oct 5
ok(r?.at.toISOString() === "2026-10-07T07:00:00.000Z" && !r.approximate, "Wed 00:00 PT = Wed 07:00 UTC in October", r?.at.toISOString());
r = nextWaiverRun(wedMidnight, new Date("2026-10-07T06:59:00Z")); // one minute before
ok(r?.at.toISOString() === "2026-10-07T07:00:00.000Z", "one minute before → that same run");
r = nextWaiverRun(wedMidnight, new Date("2026-10-07T07:00:00Z")); // exactly at the run
ok(r?.at.toISOString() === "2026-10-14T07:00:00.000Z", "at/after the run → next week");

// dow=1 (Tuesday), hr=21 → Tue 21:00 PT = Wed 04:00 UTC. Real: processed Wed 04:0x UTC.
const tue9pm = L({ waiver_day_of_week: 1, daily_waivers_hour: 21, daily_waivers: 0 });
r = nextWaiverRun(tue9pm, new Date("2026-10-05T12:00:00Z"));
ok(r?.at.toISOString() === "2026-10-07T04:00:00.000Z", "Tue 21:00 PT = Wed 04:00 UTC", r?.at.toISOString());

// Winter (PST, UTC-8): same settings shift one hour later in UTC.
r = nextWaiverRun(wedMidnight, new Date("2026-12-01T12:00:00Z")); // Tue Dec 1
ok(r?.at.toISOString() === "2026-12-02T08:00:00.000Z", "Wed 00:00 PT = 08:00 UTC after DST ends", r?.at.toISOString());

// Daily waivers: earliest possible run, flagged approximate.
const daily = L({ waiver_day_of_week: 2, daily_waivers_hour: 7, daily_waivers: 1 });
r = nextWaiverRun(daily, new Date("2026-10-05T12:00:00Z")); // Mon 05:00 PT → next 07:00 PT is Tue? Mon 07:00 PT already passed? 12:00Z = 05:00 PT Mon
ok(r?.at.toISOString() === "2026-10-05T14:00:00.000Z" && r.approximate, "daily: next 07:00 PT on ANY day, approximate", r?.at.toISOString());

// Missing / junk settings → null, never a guess.
ok(nextWaiverRun(null, new Date()) === null, "null settings → null");
ok(nextWaiverRun({ settings: {} }, new Date()) === null, "no day → null");
ok(nextWaiverRun(L({ waiver_day_of_week: 9 }), new Date()) === null, "bad day → null");

ok(formatCountdown(0) === "now" && formatCountdown(59 * 60_000) === "59m", "countdown minutes");
ok(formatCountdown(90 * 60_000) === "1h 30m" && formatCountdown(49 * 3600_000) === "2d 1h", "countdown hours/days");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
