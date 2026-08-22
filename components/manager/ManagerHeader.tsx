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
  currentLeagueId: string;
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

  const currentName = leagues.find((lg) => lg.id === currentLeagueId)?.name ?? "League";

  return (
    <div style={{ position: "relative", display: "inline-flex" }} ref={ref}>
      <button className="btn ghost sm" onClick={() => setOpen((v) => !v)}>
        {currentName} {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mgrtabmenu">
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

export default function ManagerHeader({
  leagues,
  lastSyncedAt,
}: {
  leagues: { id: string; name: string }[];
  lastSyncedAt: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [syncing, setSyncing] = useState(false);
  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await fetch("/api/manager/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      router.refresh();
    } finally {
      setSyncing(false);
    }
  };

  const leagueCtx = extractLeagueContext(pathname);
  const currentLeague = leagueCtx ? leagues.find((lg) => lg.id === leagueCtx.leagueId) : null;
  const sectionLabel = leagueCtx
    ? (LEAGUE_SUB_ROUTES.find((r) => r.slug === leagueCtx.section)?.label ?? "Overview")
    : null;

  return (
    <header className="mgrheader">
      <div className="mgrheaderleft">
        {leagueCtx && currentLeague ? (
          <div className="mgrbreadcrumb">
            <Link href="/manager/teams" className="mgrbreadcrumblink">
              My Leagues
            </Link>
            <span className="mgrbreadcrumbsep">/</span>
            <span className="mgrbreadcrumbcurrent">{currentLeague.name}</span>
            <span className="mgrbreadcrumbsep">/</span>
            <h1 className="mgrpagetitle">{sectionLabel}</h1>
          </div>
        ) : (
          <div className="mgrbreadcrumb">
            <h1 className="mgrpagetitle">{portfolioPageLabel(pathname)}</h1>
          </div>
        )}
      </div>
      <div className="mgrheaderright">
        {leagueCtx && (
          <LeagueSwitcher leagues={leagues} currentLeagueId={leagueCtx.leagueId} section={leagueCtx.section} />
        )}
        <span className="hint" style={{ margin: 0 }}>
          {mounted ? `synced ${formatRelative(lastSyncedAt)}` : ""}
        </span>
        <button className="btn ghost sm" onClick={syncNow} disabled={syncing}>
          {syncing ? "Syncing…" : "Refresh"}
        </button>
      </div>
    </header>
  );
}
