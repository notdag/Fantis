// "Reference ranks": ranks from outside sources (e.g. Flock's expert rank and
// Mason Dodd's rank) that the owner imports from their own CSV and wants to see
// next to their own rankings on the /admin tier board. Display-only — they
// never reorder or re-tier anything by themselves.
//
// Stored in the browser's localStorage, not the database: a table would be a
// migration on the shared Postgres (gated), and these are the owner's own
// imported reference numbers. Consequence: per browser/device; re-import on a
// new one. Same external-store shape as lib/leagueFavorites.ts.
import { useSyncExternalStore } from "react";

const KEY = "fantis_ref_ranks_v1";

export interface RefRank {
  expert?: number;
  mason?: number;
}
export interface RefRanks {
  at: string | null; // when imported
  count: number;
  ranks: Record<string, RefRank>; // key = refRankKey(name, pos)
}

export const EMPTY_REF_RANKS: RefRanks = { at: null, count: 0, ranks: {} };

export function refRankKey(looseName: string, pos: string): string {
  return `${looseName}|${pos}`;
}

let cachedRaw: string | null | undefined;
let cached: RefRanks = EMPTY_REF_RANKS;
const listeners = new Set<() => void>();

function read(): RefRanks {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY_REF_RANKS;
  }
  if (raw === cachedRaw) return cached; // stable reference between reads
  cachedRaw = raw;
  try {
    const v = raw ? (JSON.parse(raw) as RefRanks) : null;
    cached =
      v && typeof v === "object" && v.ranks && typeof v.ranks === "object"
        ? { at: typeof v.at === "string" ? v.at : null, count: Object.keys(v.ranks).length, ranks: v.ranks }
        : EMPTY_REF_RANKS;
  } catch {
    cached = EMPTY_REF_RANKS;
  }
  return cached;
}

function notify() {
  for (const l of listeners) l();
}

export function saveRefRanks(ranks: Record<string, RefRank>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ at: new Date().toISOString(), ranks }));
  } catch {
    // quota/blocked: nothing to persist; the UI simply won't show them next load
  }
  notify();
}

export function clearRefRanks(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRefRanks(): RefRanks {
  return useSyncExternalStore(subscribe, read, () => EMPTY_REF_RANKS);
}
