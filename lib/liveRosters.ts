// Live roster reads for the Lineups tools. The stored sync (a ~60s job over every league) can be minutes or hours old,
// and a lineup computed from a stale roster can be wrong or be rejected by Sleeper. These helpers read the owner's roster
// straight from Sleeper's public API (one cheap call per league, retried on transient failures) and let the tools
// (1) compute from live data and (2) refuse to send when the roster changed underneath them.
import { getRosters } from "./sleeper";

export interface LiveRoster {
  starters: string[];
  players: string[];
  reserve: string[];
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

export async function fetchLiveRoster(leagueId: string, rosterId: number): Promise<LiveRoster | null> {
  const rosters = await withRetry(() => getRosters(leagueId));
  const r = rosters.find((x) => x.roster_id === rosterId);
  if (!r) return null;
  return { starters: r.starters ?? [], players: r.players ?? [], reserve: r.reserve ?? [] };
}

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
        const r = await fetchLiveRoster(t.leagueId, t.rosterId);
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

// True when the roster differs in any way that matters for a lineup: who's on it, who's on IR, or who is starting
// where. Player/IR lists compare as sets; starters compare slot by slot ("" and null count as an empty slot).
export function rosterChanged(a: LiveRoster, b: LiveRoster): boolean {
  const setKey = (xs: string[]) => [...xs].sort().join(",");
  if (setKey(a.players) !== setKey(b.players)) return true;
  if (setKey(a.reserve) !== setKey(b.reserve)) return true;
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
