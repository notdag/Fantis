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

export interface ManagedSyncRun {
  id: string;
  accountId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  leaguesSeen: number;
  leaguesOk: number;
  leaguesFailed: number;
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
