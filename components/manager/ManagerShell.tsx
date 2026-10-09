"use client";

import { useEffect, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ENTRIES, isActive, type IconKey, type NavEntry } from "./managerNav";
import { LEAGUE_SUB_ROUTES, extractLeagueContext, leagueSubHref } from "./leagueSubRoutes";
import ManagerHeader, { PageTitle } from "./ManagerHeader";
import LeagueSubNavigation from "./LeagueSubNavigation";
import BottomNavBar from "./BottomNavBar";
import CommandPalette from "./CommandPalette";
import {
  IconHome,
  IconUsers,
  IconWrench,
  IconShield,
  IconCheck,
  IconFlag,
  IconX,
  IconSearch,
} from "./MgrIcons";

const ICONS: Record<IconKey, typeof IconHome> = {
  home: IconHome,
  users: IconUsers,
  wrench: IconWrench,
  shield: IconShield,
  search: IconSearch,
  check: IconCheck,
  flag: IconFlag,
};

// Every /manager/* page is a real, uncached DB round-trip (the cookie auth
// check forces the whole tree dynamic), so a nav click can take up to ~1s
// with nothing changing on screen. Spinner is a sibling of the label, not
// nested inside it, so collapsed-rail mode can hide just the label
// (.mgrnavlabel{display:none}) while this keeps working on icon-only links.
function NavLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className="mgrnavlabel">{label}</span>
      {pending && <span className="mgrtabspin" aria-hidden="true" />}
    </>
  );
}

function NavGroup({
  entry,
  pathname,
  collapsed,
}: {
  entry: Extract<NavEntry, { kind: "group" }>;
  pathname: string;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const groupActive = entry.links.some((l) => isActive(pathname, l.href));
  const Icon = ICONS[entry.icon];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Same reasoning as the dropdown this replaced: the flyout doesn't unmount
  // across a route change (the sidebar persists), so it needs an explicit
  // close on navigation rather than relying on unmount.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (collapsed) {
    return (
      <div className="mgrnavgroup mgrnavgroup-rail" ref={ref}>
        <button
          type="button"
          className={`mgrnavlink ${groupActive ? "on" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={entry.label}
        >
          <Icon aria-hidden="true" />
        </button>
        {open && (
          <div className="mgrnavflyout">
            <div className="mgrnavflyouthead">{entry.label}</div>
            {entry.links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`mgrtabmenuitem ${isActive(pathname, l.href) ? "on" : ""}`}
              >
                <NavLabel label={l.label} />
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mgrnavgroup">
      <div className="mgrnavgrouplabel">{entry.label}</div>
      {entry.links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`mgrnavlink mgrnavlink-sub ${isActive(pathname, l.href) ? "on" : ""}`}
        >
          <NavLabel label={l.label} />
        </Link>
      ))}
    </div>
  );
}

// Only rendered when the current route is inside a league (see
// extractLeagueContext) — shows which league you're in plus its 8 real
// sub-routes, so the sidebar itself answers "where am I" instead of that
// only living in page content. Collapsed-rail mode omits this (matches
// the existing collapsed behavior for portfolio groups: icon-only, no
// per-league flyout — the horizontal LeagueSubNavigation covers that case).
function CurrentLeagueNavGroup({
  pathname,
  collapsed,
  leagues,
}: {
  pathname: string;
  collapsed: boolean;
  leagues: { id: string; name: string }[];
}) {
  const ctx = extractLeagueContext(pathname);
  if (!ctx || collapsed) return null;
  const league = leagues.find((lg) => lg.id === ctx.leagueId);

  return (
    <div className="mgrnavgroup mgrnavgroup-league">
      <div className="mgrnavgrouplabel">{league?.name ?? "League"}</div>
      {LEAGUE_SUB_ROUTES.map((r) => {
        const href = leagueSubHref(ctx.leagueId, r.slug);
        return (
          <Link
            key={r.slug}
            href={href}
            className={`mgrnavlink mgrnavlink-sub ${ctx.section === r.slug ? "on" : ""}`}
          >
            <NavLabel label={r.label} />
          </Link>
        );
      })}
    </div>
  );
}

function NavList({
  pathname,
  collapsed,
  leagues,
}: {
  pathname: string;
  collapsed: boolean;
  leagues: { id: string; name: string }[];
}) {
  return (
    <nav className="mgrnav">
      {NAV_ENTRIES.map((e) => {
        if (e.kind === "link") {
          const Icon = ICONS[e.icon];
          return (
            <Link
              key={e.href}
              href={e.href}
              className={`mgrnavlink ${isActive(pathname, e.href) ? "on" : ""}`}
              aria-label={collapsed ? e.label : undefined}
            >
              <Icon aria-hidden="true" />
              <NavLabel label={e.label} />
            </Link>
          );
        }
        return <NavGroup key={e.label} entry={e} pathname={pathname} collapsed={collapsed} />;
      })}
      <CurrentLeagueNavGroup pathname={pathname} collapsed={collapsed} leagues={leagues} />
    </nav>
  );
}

// Command Center shell (prototype G, applied to every page): one horizontal menu where each group opens a dropdown.
// Hover or click opens it; it closes on navigation, Escape or an outside click.
function TopNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <nav className="cbs-nav" ref={ref} aria-label="Main" onMouseLeave={() => setOpen(null)}>
      {NAV_ENTRIES.map((e) => {
        if (e.kind === "link") {
          return (
            <Link key={e.href} href={e.href} className={`cbs-navbtn ${isActive(pathname, e.href) ? "on" : ""}`}>
              <NavLabel label={e.label} />
            </Link>
          );
        }
        const active = e.links.some((l) => isActive(pathname, l.href));
        return (
          <div key={e.label} className="cbs-navitem" onMouseEnter={() => setOpen(e.label)}>
            <button
              type="button"
              className={`cbs-navbtn ${active ? "on" : ""}`}
              aria-expanded={open === e.label}
              onClick={() => setOpen((o) => (o === e.label ? null : e.label))}
            >
              {e.label}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {open === e.label && (
              <div className="cbs-menu">
                {e.links.map((l) => (
                  <Link key={l.href} href={l.href} className={isActive(pathname, l.href) ? "on" : ""} onClick={() => setOpen(null)}>
                    <NavLabel label={l.label} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function ManagerShell({
  children,
  leagues,
  lastSyncedAt,
}: {
  children: React.ReactNode;
  leagues: { id: string; name: string }[];
  lastSyncedAt: string | null;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global Cmd/Ctrl+K — works from anywhere under /manager since ManagerShell
  // wraps every page. CommandPalette itself is only mounted while open (see
  // render below), so this is the one place that has to listen at all times.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);


  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="cbs">
      <ManagerHeader leagues={leagues} lastSyncedAt={lastSyncedAt} onSearch={() => setPaletteOpen(true)} onMenu={() => setDrawerOpen(true)} />
      <TopNav pathname={pathname} />

      <div
        className={`mgrdrawerbackdrop ${drawerOpen ? "mgropen" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <div
        className={`mgrdrawer ${drawerOpen ? "mgropen" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Sleeper Manager navigation"
      >
        <div className="mgrdrawerhead">
          <div className="mgrsidebarbrand">
            <div className="mark">F</div>
            <b>Fantis</b>
          </div>
          <button type="button" className="mgrdrawerclose" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
            <IconX />
          </button>
        </div>
        <NavList pathname={pathname} collapsed={false} leagues={leagues} />
      </div>

      <div className="cbs-main">
        <PageTitle leagues={leagues} />
        <LeagueSubNavigation />
        {children}
      </div>
      <BottomNavBar onOpenMore={() => setDrawerOpen(true)} />
      {paletteOpen && <CommandPalette leagues={leagues} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
