// Command Center 2.0 — the League Manager's selection model.
//
// A selection is a set of league ids that is independent of the current filter/search/page: filtering never drops a
// selected league, "select all filtered" adds every league matching the filter (not just the visible page), and the
// selection is kept in localStorage so it survives opening a league and coming back, or a reload. Bulk tools can then be
// opened scoped to it (`?scope=selection`). Pure functions are unit-tested in scripts/testLeagueSelection.ts.
import { useSyncExternalStore } from "react";

export type Selection = ReadonlySet<string>;

export const toggle = (sel: Selection, id: string): Set<string> => {
  const n = new Set(sel);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
};
export const addAll = (sel: Selection, ids: Iterable<string>): Set<string> => {
  const n = new Set(sel);
  for (const id of ids) n.add(id);
  return n;
};
export const removeAll = (sel: Selection, ids: Iterable<string>): Set<string> => {
  const n = new Set(sel);
  for (const id of ids) n.delete(id);
  return n;
};
// Leagues that no longer exist (deleted, archived, a new season) drop out of a stored selection.
export const prune = (sel: Selection, known: Iterable<string>): Set<string> => {
  const k = new Set(known);
  return new Set([...sel].filter((id) => k.has(id)));
};

// The header checkbox for a filtered list: "all" when every filtered league is selected, "some", or "none".
export function filterState(sel: Selection, filteredIds: readonly string[]): "all" | "some" | "none" {
  if (filteredIds.length === 0) return "none";
  let n = 0;
  for (const id of filteredIds) if (sel.has(id)) n++;
  return n === 0 ? "none" : n === filteredIds.length ? "all" : "some";
}

// Counts for the selection bar: how many are selected in total, how many of those match the current filter, and how
// many are hidden by it (so a filter never makes a selected league silently disappear from the count).
export function selectionCounts(sel: Selection, filteredIds: readonly string[]) {
  const f = new Set(filteredIds);
  let inFilter = 0;
  for (const id of sel) if (f.has(id)) inFilter++;
  return { total: sel.size, inFilter, hidden: sel.size - inFilter };
}

export function parseStored(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 40)) : new Set();
  } catch {
    return new Set();
  }
}

// ---- browser store (same useSyncExternalStore shape as lib/leagueFavorites.ts)
const KEY = "fantis_league_selection_v1";
const listeners = new Set<() => void>();
let cache: Set<string> | null = null;
const EMPTY: Set<string> = new Set();

function read(): Set<string> {
  if (cache) return cache;
  try {
    cache = parseStored(window.localStorage.getItem(KEY));
  } catch {
    cache = new Set();
  }
  return cache;
}

export function writeSelection(next: Iterable<string>) {
  cache = new Set(next);
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...cache]));
  } catch {
    // storage blocked — the selection still works for this page visit
  }
  listeners.forEach((cb) => cb());
}

export function useLeagueSelection(): Selection {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          cache = null;
          cb();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    read,
    () => EMPTY
  );
}
