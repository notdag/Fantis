"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import CommandCenterAI from "./CommandCenterAI";
import type { CcLeague } from "@/lib/commandCenter/types";

const KEY = "fantis_cc_open_v1";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
// In-memory copy so the panel still opens/closes when storage is blocked.
let mem: boolean | null = null;
const readOpen = () => {
  if (mem !== null) return mem;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage unavailable — start collapsed
  }
};

// Bottom-right launcher for the read-only Command Center AI, available on every
// /manager page. Once opened, the panel stays mounted when collapsed so a scan
// in progress, the conversation and the 5-minute league cache all survive
// collapsing it or navigating between manager pages.
export default function FloatingCommandCenter() {
  // Persisted open/closed flag; the server render is always "collapsed" so
  // hydration matches, then the real value takes over on the client.
  const open = useSyncExternalStore(subscribe, readOpen, () => false);
  const [everOpened, setEverOpened] = useState(false);
  const mounted = everOpened || open;
  const [leagues, setLeagues] = useState<CcLeague[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!mounted || leagues) return;
    let cancelled = false;
    fetch("/api/manager/command-leagues")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Couldn't load your leagues.");
        if (!cancelled) setLeagues(body.leagues as CcLeague[]);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load your leagues."));
    return () => {
      cancelled = true;
    };
  }, [mounted, leagues]);

  const toggle = (next: boolean) => {
    if (next) setEverOpened(true);
    mem = next;
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
    listeners.forEach((cb) => cb());
  };

  return (
    <>
      {mounted && (
        <div className="ccpanel" style={{ display: open ? "flex" : "none" }} role="dialog" aria-label="Command Center AI">
          <div className="ccpanelbar">
            <strong>Command Center AI</strong>
            <span className="ccpanelmode">READ-ONLY</span>
            <span style={{ flex: 1 }} />
            <button className="ccpanelbtn" onClick={() => toggle(false)} aria-label="Collapse Command Center AI" title="Collapse">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3.5 6.5 8 11l4.5-4.5" />
              </svg>
            </button>
          </div>
          <div className="ccpanelbody">
            {error && <div className="err" style={{ margin: 14 }}>{error}</div>}
            {!leagues && !error && <p className="hint" style={{ margin: 14 }}>Loading your leagues…</p>}
            {leagues && <CommandCenterAI leagues={leagues} />}
          </div>
        </div>
      )}
      {!open && (
        <button className="cclauncher" onClick={() => toggle(true)} aria-label="Open Command Center AI">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
          </svg>
          Command Center AI
          <span className="cclaunchermode">read-only</span>
        </button>
      )}
    </>
  );
}
