"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive } from "./managerNav";
import { extractLeagueContext, leagueSubHref } from "./leagueSubRoutes";
import { IconHome, IconUsers, IconCalendar, IconMenu } from "./MgrIcons";

// Mobile-only bottom bar (<768px, see manager.css) for the 4 most-reached
// destinations — the drawer (opened via "More") still has everything else,
// this is just faster thumb-reach for the common cases. Third slot is
// context-sensitive: current league's Overview when inside a league,
// otherwise Drafts (a real, frequently-checked portfolio page).
export default function BottomNavBar({ onOpenMore }: { onOpenMore: () => void }) {
  const pathname = usePathname();
  const ctx = extractLeagueContext(pathname);
  const thirdItem = ctx
    ? { href: leagueSubHref(ctx.leagueId, "overview"), label: "League", active: true }
    : { href: "/manager/drafts", label: "Drafts", active: isActive(pathname, "/manager/drafts") };

  return (
    <nav className="mgrbottomnav" aria-label="Primary">
      <Link href="/manager" className={`mgrbottomnavitem ${isActive(pathname, "/manager") ? "on" : ""}`}>
        <IconHome width={20} height={20} />
        <span>Command</span>
      </Link>
      <Link href="/manager/teams" className={`mgrbottomnavitem ${isActive(pathname, "/manager/teams") ? "on" : ""}`}>
        <IconUsers width={20} height={20} />
        <span>Leagues</span>
      </Link>
      <Link href={thirdItem.href} className={`mgrbottomnavitem ${thirdItem.active ? "on" : ""}`}>
        <IconCalendar width={20} height={20} />
        <span>{thirdItem.label}</span>
      </Link>
      <button type="button" className="mgrbottomnavitem" onClick={onOpenMore}>
        <IconMenu width={20} height={20} />
        <span>More</span>
      </button>
    </nav>
  );
}
