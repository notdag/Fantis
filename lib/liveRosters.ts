// Live roster reads for the Lineups tools. The stored sync (a ~60s job over every league) can be minutes or hours old,
// and a change built from a stale roster can be wrong, be rejected by Sleeper, or undo something you did in the Sleeper
// app. These helpers read the owner's roster (and, for adds, everyone's) straight from Sleeper's public API — one cheap
// call per league, retried on transient failures — so the tools can (1) compute from live data and (2) run a pre-flight
// check right before a batch is sent and refuse any league whose roster changed underneath them.
import { getRosters } from "./sleeper";

export interface LiveRoster {
  starters: string[];
  players: string[];
  reserve: string[];
  // Everyone rostered by ANY team in the league (players + IR) — what "is he still available?" needs.
  allRostered?: string[];
}

export interface LiveTarget {
  leagueId: string;
  rosterId: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retries transient failures (network blips, 429/5xx) with a short backoff. A 404 (league gone) is not retried.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : "";
      if (msg === "404" || msg === "400") break;
      if (i < attempts - 1) await wait(350 * (i + 1));
    }
  }
  throw last;
}

// One call returns every team's roster in the league — mine plus the set of everyone rostered.
export async function fetchLiveLeague(leagueId: string, rosterId: number): Promise<LiveRoster | null> {
  const rosters = await withRetry(() => getRosters(leagueId));
  const r = rosters.find((x) => x.roster_id === rosterId);
  if (!r) return null;
  const all = new Set<string>();
  for (const t of rosters) {
    for (const id of t.players ?? []) all.add(id);
    for (const id of t.reserve ?? []) all.add(id);
  }
  return { starters: r.starters ?? [], players: r.players ?? [], reserve: r.reserve ?? [], allRostered: [...all] };
}

export const fetchLiveRoster = fetchLiveLeague;

export interface LiveResult {
  live: Record<string, LiveRoster>;
  failed: { leagueId: string; message: string }[];
}

// Bounded concurrency so ~200 leagues load in seconds without hammering Sleeper's public API.
export async function fetchAllLive(
  targets: LiveTarget[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<LiveResult> {
  const live: Record<string, LiveRoster> = {};
  const failed: { leagueId: string; message: string }[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= targets.length) return;
      const t = targets[i];
      try {
        const r = await fetchLiveLeague(t.leagueId, t.rosterId);
        if (r) live[t.leagueId] = r;
        else failed.push({ leagueId: t.leagueId, message: "roster not found" });
      } catch (e) {
        failed.push({ leagueId: t.leagueId, message: e instanceof Error ? e.message : "failed" });
      }
      done++;
      opts.onProgress?.(done, targets.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, Math.max(1, targets.length)) }, worker));
  return { live, failed };
}

const norm = (id: string | null | undefined) => (!id ? "0" : id);

// True when the roster differs in a way that matters: who's on it, who's on IR, and (unless ignored) who is starting
// where. Player/IR lists compare as sets; starters compare slot by slot ("" and null count as an empty slot).
// `ignoreStarters` is for changes that never touch the current lineup (adds, most IR moves, future-week lineups).
export function rosterChanged(a: LiveRoster, b: LiveRoster, opts: { ignoreStarters?: boolean } = {}): boolean {
  const setKey = (xs: string[]) => [...xs].sort().join(",");
  if (setKey(a.players) !== setKey(b.players)) return true;
  if (setKey(a.reserve) !== setKey(b.reserve)) return true;
  if (opts.ignoreStarters) return false;
  const n = Math.max(a.starters.length, b.starters.length);
  for (let i = 0; i < n; i++) if (norm(a.starters[i]) !== norm(b.starters[i])) return true;
  return false;
}

// Overlay live rosters onto the stored ones (only where a live read succeeded and the stored roster exists).
export function mergeLive<T extends { league: { id: string }; roster: { starters: string[]; players: string[]; reserve: string[] } | null }>(
  items: T[],
  live: Record<string, LiveRoster>
): T[] {
  return items.map((it) => {
    const lv = live[it.league.id];
    if (!lv || !it.roster) return it;
    return { ...it, roster: { ...it.roster, starters: lv.starters, players: lv.players, reserve: lv.reserve } };
  });
}

export const MSG_CHANGED =
  "Roster changed on Sleeper since this data was loaded (a drop, add, IR move or lineup edit) — nothing was sent for this league. Reload rosters (Lineups) or press Refresh (top right), then review.";
export const MSG_UNREADABLE = "Couldn't read this roster from Sleeper just now, so nothing was sent for this league. Retry in a moment.";

export interface PreflightRow {
  leagueId: string;
  rosterId: number;
  // The roster this change was planned from (null = unknown, can only be checked for readability).
  base: LiveRoster | null;
  // Does this change depend on the CURRENT lineup (clearing a starter, setting this week's starters)?
  strictStarters: boolean;
}

export interface PreflightResult {
  fresh?: LiveRoster;
  // Why this league must not be touched; undefined = clear to send.
  blocked?: string;
}

// Run once per batch, right before sending: re-read each affected league from Sleeper and decide, per league, whether
// it is still safe. One check per league (not per row) on purpose — rows for the same league would otherwise see each
// other's writes as "the roster changed".
export async function preflightRosters(
  rows: PreflightRow[],
  opts: { concurrency?: number; fetcher?: (leagueId: string, rosterId: number) => Promise<LiveRoster | null> } = {}
): Promise<Record<string, PreflightResult>> {
  const fetcher = opts.fetcher ?? fetchLiveLeague;
  const byLeague = new Map<string, { rosterId: number; base: LiveRoster | null; strict: boolean }>();
  for (const r of rows) {
    const cur = byLeague.get(r.leagueId);
    if (!cur) byLeague.set(r.leagueId, { rosterId: r.rosterId, base: r.base, strict: r.strictStarters });
    else cur.strict = cur.strict || r.strictStarters;
  }
  const entries = [...byLeague.entries()];
  const out: Record<string, PreflightResult> = {};
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= entries.length) return;
      const [leagueId, e] = entries[i];
      try {
        const fresh = await fetcher(leagueId, e.rosterId);
        if (!fresh) out[leagueId] = { blocked: MSG_UNREADABLE };
        else if (e.base && rosterChanged(e.base, fresh, { ignoreStarters: !e.strict })) out[leagueId] = { fresh, blocked: MSG_CHANGED };
        else out[leagueId] = { fresh };
      } catch {
        out[leagueId] = { blocked: MSG_UNREADABLE };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, Math.max(1, entries.length)) }, worker));
  return out;
}
