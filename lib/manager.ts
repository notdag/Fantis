// Small display helpers + plain data shapes for the Sleeper Manager
// dashboard. Deliberately not the Prisma-generated model types directly —
// Prisma 7's generated types are internal (@ts-nocheck) and verbose; the
// server pages map query results into these plain shapes before handing
// them to client components, keeping the boundary simple.

export interface ManagedAccount {
  id: string;
  username: string;
  displayName: string | null;
  connectedAt: string; // ISO — Dates cross the server/client boundary as strings
  lastSyncedAt: string | null;
}

export interface ManagedLeague {
  id: string;
  accountId: string;
  accountUsername: string;
  name: string;
  season: string;
  totalRosters: number;
  status: string;
  settings: unknown;
  lastSyncedAt: string | null;
}

export interface ManagedSyncRunError {
  leagueId: string;
  leagueName?: string;
  message: string;
}

export interface ManagedSyncRun {
  id: string;
  accountId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  leaguesSeen: number;
  leaguesOk: number;
  leaguesFailed: number;
  errors: ManagedSyncRunError[] | null;
}

export interface ManagedRoster {
  leagueId: string;
  rosterId: number;
  starters: string[];
  players: string[];
  wins: number;
  losses: number;
  ties: number;
  fpts: number | null;
  fptsAgainst: number | null;
  lastSyncedAt: string | null;
}

export interface ManagedMatchup {
  week: number;
  myPoints: number;
  opponentTeamName: string | null;
  opponentPoints: number | null;
}

export interface ManagedDraft {
  id: string;
  status: string;
  type: string | null;
  startTime: string | null;
}

export interface ManagedAlert {
  id: string;
  type: string;
  severity: "action_required" | "review";
  message: string;
  playerId: string | null;
  week: number;
  createdAt: string;
  resolvedAt: string | null;
  snoozedUntil: string | null;
}

export function isSnoozed(alert: ManagedAlert): boolean {
  return alert.snoozedUntil != null && new Date(alert.snoozedUntil) > new Date();
}

export interface ManagedAction {
  id: string;
  leagueId: string;
  status: "pending" | "approved" | "running" | "completed" | "failed" | "cancelled";
  targetUrl: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

// A ping older than this reads as "not connected" — the userscript pings
// every ~5s while /manager is open, so anything past a couple of missed
// beats means the script isn't actually running right now.
const AUTOMATION_STALE_MS = 15000;

export function automationConnected(lastPingAt: string | null | undefined): boolean {
  if (!lastPingAt) return false;
  return Date.now() - new Date(lastPingAt).getTime() < AUTOMATION_STALE_MS;
}

// Sleeper's own league status values, verbatim. Not re-validated against an
// enum in the DB (see prisma/schema.prisma) so an unrecognized future value
// from Sleeper just falls through to the default color below instead of
// breaking anything.
const STATUS_COLOR: Record<string, string> = {
  pre_draft: "var(--dim)",
  drafting: "var(--amber)",
  in_season: "var(--mint)",
  complete: "var(--muted)",
};

// Same color-mix() technique as posChipStyle() in lib/players.ts — a
// tinted background + border derived from the status color, text in the
// full hue, reusing the existing .pos chip class rather than a new one.
export function statusChipStyle(status: string) {
  const c = STATUS_COLOR[status] ?? "var(--muted)";
  return {
    color: c,
    background: `color-mix(in srgb, ${c} 20%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 52%, transparent)`,
  };
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pre_draft":
      return "Pre-draft";
    case "drafting":
      return "Drafting";
    case "in_season":
      return "In season";
    case "complete":
      return "Complete";
    default:
      return status;
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// A real "all clear" state is UI-only (absence of any Alert row for a
// league) — not a stored severity value, so it isn't in AlertSeverity.
const SEVERITY_COLOR: Record<string, string> = {
  action_required: "var(--red)",
  review: "var(--amber)",
  clear: "var(--mint)",
};

export function alertSeverityChipStyle(severity: string) {
  const c = SEVERITY_COLOR[severity] ?? "var(--muted)";
  return {
    color: c,
    background: `color-mix(in srgb, ${c} 20%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 52%, transparent)`,
  };
}

// A future date, formatted the way the dashboard's "Upcoming Drafts"
// section needs it ("Today 7:00 PM" / "Tomorrow 7:00 PM" / "Thu 7:00 PM").
export function formatUpcoming(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / dayMs);
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Tomorrow ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    return `${date.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  }
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}
