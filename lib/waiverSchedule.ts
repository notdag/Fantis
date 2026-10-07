// When does Sleeper next process waivers for a league? Pure — no I/O.
//
// Verified empirically against real processed claims (2026-10, 3 different
// setting groups across the owner's leagues, via Sleeper's `status_updated`):
//   - `waiver_day_of_week`: 0 = Monday … 6 = Sunday  (dow=2 → Wednesday)
//   - `daily_waivers_hour`: hour of day in **US Pacific time**, not UTC
//     (hr=0 → processed ~07:05–07:15 UTC; hr=21 → 04:0x UTC; hr=7 → 14:0x UTC,
//     all = UTC-7 in October). Runs a few minutes after the hour.
// The Pacific-time part is INFERRED from those matches (Sleeper doesn't
// document it); every figure built on this says so in the UI.
//
// Daily-waiver leagues (`daily_waivers === 1`) also process on other days via
// `daily_waivers_days`, a bitmask I could not decode with confidence — so for
// those the result is the EARLIEST possible run (next time that hour comes
// round on any day), flagged `approximate`. That errs toward an earlier
// deadline, never a later one.
const TZ = "America/Los_Angeles";

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  wd: number; // JS weekday, 0 = Sunday
}

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  weekday: "short",
});
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function wallInPacific(date: Date): Wall {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: WD[p.weekday] };
}

// The real instant at which the Pacific wall clock reads y-mo-d h:00.
function pacificWallToInstant(y: number, mo: number, d: number, h: number): Date {
  const guess = Date.UTC(y, mo - 1, d, h, 0, 0);
  // offset = how far Pacific wall time is from UTC at (about) that moment
  for (const off of [7, 8]) {
    const cand = new Date(guess + off * 3600_000);
    const w = wallInPacific(cand);
    if (w.y === y && w.mo === mo && w.d === d && w.h === h) return cand;
  }
  return new Date(guess + 8 * 3600_000);
}

export interface WaiverRun {
  at: Date; // next processing instant
  approximate: boolean; // daily-waiver league: earliest possible run
}

function num(settings: unknown, key: string): number | null {
  if (!settings || typeof settings !== "object") return null;
  const inner = (settings as Record<string, unknown>).settings;
  if (!inner || typeof inner !== "object") return null;
  const v = (inner as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

export function nextWaiverRun(settings: unknown, now: Date): WaiverRun | null {
  const dow = num(settings, "waiver_day_of_week");
  const hour = num(settings, "daily_waivers_hour") ?? 0;
  if (dow == null || dow < 0 || dow > 6 || hour < 0 || hour > 23) return null;
  const daily = num(settings, "daily_waivers") === 1;
  const jsDay = (dow + 1) % 7; // 0=Mon → JS 1; 6=Sun → JS 0

  const nowWall = wallInPacific(now);
  // Walk forward day by day (Pacific calendar) until a qualifying instant > now.
  for (let i = 0; i <= 8; i++) {
    const base = new Date(Date.UTC(nowWall.y, nowWall.mo - 1, nowWall.d + i, 12));
    const wd = (nowWall.wd + i) % 7;
    if (!daily && wd !== jsDay) continue;
    const at = pacificWallToInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour);
    if (at.getTime() > now.getTime()) return { at, approximate: daily };
  }
  return null;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatPacific(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date) + " PT";
}
