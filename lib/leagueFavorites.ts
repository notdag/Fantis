"use client";

import { useSyncExternalStore } from "react";

// A handful of leagues pinned so they surface first across list pages,
// instead of being buried alphabetically among 200+. Deliberately
// client-local (localStorage), not a database column: this account is a
// single owner's browser, the same place the Sleeper write-access token
// and the Command Center's own settings already live (see ccStore.ts) — a
// real per-league DB field would need a schema migration against the
// shared dev/prod database, a bigger, riskier change than a UI preference
// like this calls for. Same tiny external-store shape as ccStore.ts
// (useSyncExternalStore, not useState+useEffect) so React handles the
// server/client snapshot mismatch correctly instead of a manual
// "mounted" hydration gate.
const KEY = "fantis_league_favorites";

const listeners = new Set<() => void>();
let mem: Set<string> | null = null;
let cachedRaw: string | null | undefined = undefined;
let cached: Set<string> = new Set();

function read(): Set<string> {
  if (mem !== null) return mem;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    cached = raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    return cached;
  } catch {
    return new Set();
  }
}

function write(next: Set<string>) {
  mem = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Array.from(next)));
  } catch {
    // Private browsing / storage disabled — the in-memory copy still
    // applies for this session, just won't persist across reloads.
  }
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

const EMPTY = new Set<string>();

export function useLeagueFavorites() {
  const favorites = useSyncExternalStore(subscribe, read, () => EMPTY);

  const toggle = (leagueId: string) => {
    const next = new Set(read());
    if (next.has(leagueId)) next.delete(leagueId);
    else next.add(leagueId);
    write(next);
  };

  return { favorites, toggle, isFavorite: (id: string) => favorites.has(id) };
}
