"use client";

import { useEffect, useRef, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

interface TabLink {
  href: string;
  label: string;
}

interface TabEntry {
  label: string;
  href?: string; // standalone tab when set
  children?: TabLink[]; // dropdown group when set instead
}

// Grouped 2026-08 — 11 flat tabs got hard to scan once real leagues passed
// 100. Every route is unchanged; this only changes how they're reached.
// Grouped by what you're actually doing: browsing how your teams are
// doing, taking an action, or league-level housekeeping you touch rarely.
const TABS: TabEntry[] = [
  { label: "Today", href: "/manager" },
  {
    label: "My Teams",
    children: [
      { href: "/manager/teams", label: "My Teams" },
      { href: "/manager/matchups", label: "Matchups" },
      { href: "/manager/byes", label: "Byes" },
      { href: "/manager/injuries", label: "Injuries" },
    ],
  },
  {
    label: "Tools",
    children: [
      { href: "/manager/actions", label: "Action Queue" },
      { href: "/manager/waiver", label: "Waiver Assistant" },
      { href: "/manager/player", label: "Player search" },
    ],
  },
  {
    label: "League Ops",
    children: [
      { href: "/manager/drafts", label: "Drafts" },
      { href: "/manager/commissioner", label: "Commissioner" },
      { href: "/manager/history", label: "History" },
    ],
  },
];

// Same per-link pending feedback as before useLinkStatus() replaced the
// loading.tsx approach — every /manager/* nav is a real DB round-trip.
function TabLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {label}
      {pending && <span className="mgrtabspin" aria-hidden="true" />}
    </>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/manager" ? pathname === "/manager" : pathname.startsWith(href);
}

function TabGroup({ label, items, pathname }: { label: string; items: TabLink[]; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const groupActive = items.some((c) => isActive(pathname, c.href));

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Closing on route change (rather than leaving it open) matters here
  // specifically because clicking a menu item doesn't unmount TabGroup —
  // the whole tab bar persists across /manager/* navigations.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="mgrtabgroup" ref={ref}>
      <button
        type="button"
        className={`mgrtab ${groupActive ? "on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {label}
        <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mgrtabmenu">
          {items.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className={`mgrtabmenuitem ${isActive(pathname, c.href) ? "on" : ""}`}
            >
              <TabLabel label={c.label} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MgrTabs() {
  const pathname = usePathname();
  return (
    <div className="mgrtabs">
      {TABS.map((t) =>
        t.href ? (
          <Link key={t.href} href={t.href} className={`mgrtab ${isActive(pathname, t.href) ? "on" : ""}`}>
            <TabLabel label={t.label} />
          </Link>
        ) : (
          <TabGroup key={t.label} label={t.label} items={t.children!} pathname={pathname} />
        )
      )}
    </div>
  );
}
