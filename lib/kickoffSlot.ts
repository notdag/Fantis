// Which kickoff window a game is in, for roster-lock strategy. Always judged in US PACIFIC time, never the viewer's own
// time zone: a Saturday 9 PM PT game is 04:00 UTC Sunday, and judging by the host clock would call it a Sunday game and let
// it into FLEX. Pacific is also the zone the owner thinks in ("the 10 AM Sunday games").
//
//   THU / FRI / SAT  — lock days before Sunday; never belong in a FLEX slot
//   SUN_EARLY        — Sunday before noon PT: the 10:00 AM slot (and the 6:30 AM London games). Prefer a true RB/WR/TE slot.
//   SUN_LATE         — Sunday from noon PT: the 1:05 / 1:25 PM slots and Sunday night. Prefer FLEX (decide as late as possible).
//   MON              — Monday night; the latest lock of the week. Prefer FLEX.
export type KickoffSlot = "THU" | "FRI" | "SAT" | "SUN_EARLY" | "SUN_LATE" | "MON";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

export function kickoffSlot(iso: string | undefined | null): KickoffSlot | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  let weekday = "";
  let hour = 0;
  for (const p of fmt.formatToParts(new Date(t))) {
    if (p.type === "weekday") weekday = p.value;
    if (p.type === "hour") hour = Number(p.value);
  }
  switch (weekday) {
    case "Thu": return "THU";
    case "Fri": return "FRI";
    case "Sat": return "SAT";
    case "Mon": return "MON";
    case "Sun": return hour < 12 ? "SUN_EARLY" : "SUN_LATE";
    default: return undefined; // Tue/Wed: not a normal NFL game day
  }
}

// Short label for UI ("THU", "Sun 10 AM", "Sun late", "MON").
export function kickoffSlotLabel(slot: KickoffSlot | undefined): string {
  switch (slot) {
    case "SUN_EARLY": return "Sun early";
    case "SUN_LATE": return "Sun late";
    case undefined: return "";
    default: return slot;
  }
}
