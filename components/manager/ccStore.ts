"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_AUTO, isPermission, normalizeAuto, type AutoConfig, type Permission } from "@/lib/commandCenter/proposals";

// Tiny persisted store (localStorage + in-memory fallback) for the Command
// Center's own settings: permission mode, bulk switch, auto-rule config. These
// live in this browser only — the same place the Sleeper login token lives, and
// for the same reason: execution is browser-side.
function createStore<T>(key: string, initial: T, normalize: (v: unknown) => T) {
  const listeners = new Set<() => void>();
  let mem: T | null = null;
  let cached: T = initial;
  let cachedRaw: string | null | undefined = undefined;

  const read = (): T => {
    if (mem !== null) return mem;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === cachedRaw) return cached;
      cachedRaw = raw;
      cached = raw ? normalize(JSON.parse(raw)) : initial;
      return cached;
    } catch {
      return initial;
    }
  };
  const write = (v: T) => {
    mem = v;
    try {
      window.localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // storage blocked — the in-memory copy still applies for this session
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  };
  return { read, write, use: () => useSyncExternalStore(subscribe, read, () => initial) };
}

const permissionStore = createStore<Permission>("fantis_cc_permission_v1", "READ_ONLY", (v) => (isPermission(v) ? v : "READ_ONLY"));
export const usePermission = permissionStore.use;
export const readPermission = permissionStore.read;
export const writePermission = permissionStore.write;

const bulkStore = createStore<boolean>("fantis_cc_bulk_v1", false, (v) => v === true);
export const useBulkEnabled = bulkStore.use;
export const writeBulkEnabled = bulkStore.write;

const autoStore = createStore<AutoConfig>("fantis_cc_auto_v1", DEFAULT_AUTO, normalizeAuto);
export const useAutoConfig = autoStore.use;
export const readAutoConfig = autoStore.read;
export const writeAutoConfig = autoStore.write;

// Auto-execution counters per calendar day (local), so the daily cap holds across reloads.
export interface AutoDay {
  day: string;
  executed: number;
  lastRunAt: number | null;
  lastMessage: string;
}
const today = () => new Date().toISOString().slice(0, 10);
const autoDayStore = createStore<AutoDay>("fantis_cc_auto_day_v1", { day: today(), executed: 0, lastRunAt: null, lastMessage: "" }, (v) => {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const d = typeof o.day === "string" ? o.day : today();
  const fresh = d === today();
  return {
    day: today(),
    executed: fresh && typeof o.executed === "number" ? o.executed : 0,
    lastRunAt: typeof o.lastRunAt === "number" ? o.lastRunAt : null,
    lastMessage: typeof o.lastMessage === "string" ? o.lastMessage : "",
  };
});
export const useAutoDay = autoDayStore.use;
export const readAutoDay = () => {
  const d = autoDayStore.read();
  return d.day === today() ? d : { ...d, day: today(), executed: 0 };
};
export const writeAutoDay = autoDayStore.write;
