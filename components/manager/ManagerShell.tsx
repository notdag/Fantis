"use client";

import { useEffect, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ENTRIES, isActive, type IconKey, type NavEntry } from "./managerNav";
import { LEAGUE_SUB_ROUTES, extractLeagueContext, leagueSubHref } from "./leagueSubRoutes";
import ManagerHeader from "./ManagerHeader";
import LeagueSubNavigation from "./LeagueSubNavigation";
import BottomNavBar from "./BottomNavBar";
import {
  IconHome,
  IconUsers,
  IconWrench,
  IconShield,
  IconChevronLeft,
  IconChevronRight,
  IconMenu,
  IconX,
} from "./MgrIcons";

const COOKIE = "fantis_mgr_sidebar";

const ICONS: Record<IconKey, typeof IconHome> = {
  home: IconHome,
  users: IconUsers,
  wrench: IconWrench,
  shield: IconShield,
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

export default function ManagerShell({
  children,
  initialCollapsed,
  leagues,
  lastSyncedAt,
}: {
  children: React.ReactNode;
  initialCollapsed: boolean;
  leagues: { id: string; name: string }[];
  lastSyncedAt: string | null;
}) {
  const pathname = usePathname();
  // Matches SSR exactly (initialCollapsed comes from the same cookie the
  // browser sends with the request) — no mounted-gate hydration hack needed
  // here, unlike most Date.now()/localStorage-dependent state elsewhere in
  // this codebase.
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `${COOKIE}=${next ? "1" : "0"}; path=/manager; max-age=31536000; SameSite=Lax`;
      return next;
    });
  }

  return (
    <div className={`mgrshell ${collapsed ? "mgrcollapsed" : ""}`}>
      <aside className="mgrsidebar">
        <div className="mgrsidebarbrand">
          <div className="mark">F</div>
          <b>Fantis</b>
        </div>
        <NavList pathname={pathname} collapsed={collapsed} leagues={leagues} />
        <button
          type="button"
          className="mgrcollapsebtn"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
        </button>
      </aside>

      <div className="mgrtopbar">
        <button type="button" className="mgrhamburger" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
          <IconMenu />
        </button>
        <div className="mgrsidebarbrand">
          <div className="mark">F</div>
          <b>Fantis</b>
        </div>
      </div>

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

      <div className="mgrmain">
        <ManagerHeader leagues={leagues} lastSyncedAt={lastSyncedAt} />
        <div className="wrap">
          <LeagueSubNavigation />
          {children}
        </div>
      </div>
      <BottomNavBar onOpenMore={() => setDrawerOpen(true)} />
    </div>
  );
}
