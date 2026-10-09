"use client";

import { useSyncExternalStore } from "react";
import { isPermission, type Permission } from "@/lib/commandCenter/proposals";

// Tiny persisted store (localStorage + in-memory fallback) for the Command
// Center's own settings: the Planning/Live mode and the bulk-execution switch.
// These live in this browser only — the same place the Sleeper login token
// lives, and for the same reason: execution is browser-side.
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

const permissionStore = createStore<Permission>("fantis_cc_permission_v1", "PLANNING", (v) => (isPermission(v) ? v : "PLANNING"));
export const usePermission = permissionStore.use;
export const readPermission = permissionStore.read;
export const writePermission = permissionStore.write;

const bulkStore = createStore<boolean>("fantis_cc_bulk_v1", false, (v) => v === true);
export const useBulkEnabled = bulkStore.use;
export const writeBulkEnabled = bulkStore.write;

// ---- Command bar → chat hand-off (Command Center 2.0). The command bar can open the chat panel with a question typed in
// (never sent automatically — the person presses Enter). Kept in memory; the chat may not be mounted yet when it's set.
let pendingPrefill: string | null = null;
export const PREFILL_EVENT = "fantis:cc-prefill";
export function requestChatPrefill(text: string) {
  pendingPrefill = text;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PREFILL_EVENT));
}
export function takeChatPrefill(): string | null {
  const t = pendingPrefill;
  pendingPrefill = null;
  return t;
}
