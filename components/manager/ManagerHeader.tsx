"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { NAV_ENTRIES } from "./managerNav";
import { LEAGUE_SUB_ROUTES, extractLeagueContext, leagueSubHref } from "./leagueSubRoutes";
import { formatRelative } from "@/lib/manager";

function portfolioPageLabel(pathname: string): string {
  for (const entry of NAV_ENTRIES) {
    if (entry.kind === "link" && entry.href === pathname) return entry.label;
    if (entry.kind === "group") {
      const match = entry.links.find((l) => l.href === pathname);
      if (match) return match.label;
    }
  }
  return "Sleeper Manager";
}

// League switcher — relocated here from the old page-content LeagueDetail.tsx
// so it's visible on every league-scoped route instead of buried in one
// page's content. Preserves the current section when switching leagues
// (e.g. viewing League A's Standings and switching to League B lands on
// League B's Standings, not its Overview) — falls back to overview if
// the target somehow doesn't have that route (it always does, all 8
// league routes exist for every league).
function LeagueSwitcher({
  leagues,
  currentLeagueId,
  section,
}: {
  leagues: { id: string; name: string }[];
  currentLeagueId: string | null;
  section: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [pathname]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leagues
      .filter((lg) => lg.id !== currentLeagueId && (!q || lg.name.toLowerCase().includes(q)))
      .slice(0, 20);
  }, [leagues, currentLeagueId, query]);

  const current = leagues.find((lg) => lg.id === currentLeagueId);
  const tag = current ? (current.name.match(/#\s?(\d{1,4})/)?.[1] ? `#${current.name.match(/#\s?(\d{1,4})/)![1]}` : current.name.slice(0, 2).toUpperCase()) : null;

  return (
    <div className="cbs-switch" ref={ref}>
      <button className="cbs-league" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="listbox">
        <span className="cbs-dot">{tag ?? leagues.length}</span>
        <span className="cbs-league-nm">{current ? current.name : "Jump to a league"}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="cbs-pop">
          <input
            className="input"
            style={{ padding: "6px 8px", fontSize: 12.5, width: "100%", marginBottom: 4 }}
            placeholder="Search leagues…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mgrswitcherlist">
            {results.length === 0 ? (
              <div className="hint" style={{ padding: "8px 12px", margin: 0 }}>
                No leagues found.
              </div>
            ) : (
              results.map((lg) => (
                <Link key={lg.id} href={leagueSubHref(lg.id, section)} className="mgrtabmenuitem">
                  {lg.name}
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// The page's own title row (breadcrumb inside a league). The Command Center home draws its own header.
export function PageTitle({ leagues }: { leagues: { id: string; name: string }[] }) {
  const pathname = usePathname();
  if (pathname === "/manager") return null;
  const leagueCtx = extractLeagueContext(pathname);
  const currentLeague = leagueCtx ? leagues.find((lg) => lg.id === leagueCtx.leagueId) : null;
  const sectionLabel = leagueCtx ? (LEAGUE_SUB_ROUTES.find((r) => r.slug === leagueCtx.section)?.label ?? "Overview") : null;
  return (
    <header className="cbs-pagehead">
      {leagueCtx && currentLeague ? (
        <>
          <nav className="cbs-crumbs" aria-label="Breadcrumb">
            <Link href="/manager/teams">All leagues</Link>
            <span aria-hidden>/</span>
            <Link href={leagueSubHref(leagueCtx.leagueId, "overview")}>{currentLeague.name}</Link>
          </nav>
          <h1>{sectionLabel}</h1>
        </>
      ) : (
        <h1>{portfolioPageLabel(pathname)}</h1>
      )}
    </header>
  );
}

// Top bar (Command Center look): brand, a global league switcher, search, and sync with its status.
export default function ManagerHeader({
  leagues,
  lastSyncedAt,
  onSearch,
  onMenu,
}: {
  leagues: { id: string; name: string }[];
  lastSyncedAt: string | null;
  onSearch: () => void;
  onMenu: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // A full sync reads every league from Sleeper and takes about a minute, so the button shows a running timer and,
  // when it ends, says exactly what happened (success, partial failure, or why it failed) instead of staying silent.
  const [syncing, setSyncing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [syncMsg, setSyncMsg] = useState<{ text: string; tone: "ok" | "warn" | "err" } | null>(null);
  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    try {
      const res = await fetch("/api/manager/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        leaguesSeen?: number;
        leaguesOk?: number;
        leaguesFailed?: number;
      };
      const secs = Math.round((Date.now() - started) / 1000);
      if (!res.ok) {
        setSyncMsg({
          text:
            res.status === 401
              ? "Sync failed: your admin session expired — reload the page and sign in again."
              : `Sync failed (${res.status}${body.error ? `: ${body.error}` : ""}). Nothing was lost — try again.`,
          tone: "err",
        });
      } else if ((body.leaguesFailed ?? 0) > 0) {
        setSyncMsg({ text: `Synced ${body.leaguesOk}/${body.leaguesSeen} leagues in ${secs}s — ${body.leaguesFailed} failed (they keep their last good data).`, tone: "warn" });
        router.refresh();
      } else {
        setSyncMsg({ text: `✓ Synced ${body.leaguesOk ?? body.leaguesSeen ?? 0} leagues in ${secs}s`, tone: "ok" });
        router.refresh();
      }
    } catch {
      setSyncMsg({ text: "Couldn't reach the server (network or timeout). Nothing was lost — try again.", tone: "err" });
    } finally {
      clearInterval(timer);
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 15000);
    }
  };

  // The command bar's "Sync all leagues now" action triggers the same sync as the Refresh button.
  const syncRef = useRef(syncNow);
  useEffect(() => {
    syncRef.current = syncNow;
  });
  useEffect(() => {
    const go = () => void syncRef.current();
    window.addEventListener("fantis:sync-now", go);
    return () => window.removeEventListener("fantis:sync-now", go);
  }, []);

  const leagueCtx = extractLeagueContext(pathname);

  return (
    <div className="cbs-top">
      <button type="button" className="cbs-icon cbs-burger" onClick={onMenu} aria-label="Open menu">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <Link href="/manager" className="cbs-brand">
        <span className="cbs-mark">F</span>
        <span>
          <b>Fantis</b>
          <em>Command</em>
        </span>
      </Link>
      <LeagueSwitcher leagues={leagues} currentLeagueId={leagueCtx?.leagueId ?? null} section={leagueCtx?.section ?? "overview"} />
      <div className="cbs-right">
        <button type="button" className="cbs-search" onClick={onSearch} aria-label="Search leagues and players">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
            <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3" />
          </svg>
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        {syncMsg ? (
          <span className={`cbs-status ${syncMsg.tone}`} role="status">{syncMsg.text}</span>
        ) : (
          <span className="cbs-synced">{mounted ? `Synced ${formatRelative(lastSyncedAt)}` : ""}</span>
        )}
        <button
          className="cbs-sync"
          onClick={syncNow}
          disabled={syncing}
          title="Re-reads every league from Sleeper (about a minute). The Lineups tools already read rosters live, so you only need this for the other pages."
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={syncing ? "spin" : ""}>
            <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5" />
          </svg>
          {syncing ? `Syncing… ${elapsed}s` : "Sync all"}
        </button>
      </div>
    </div>
  );
}
