"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEAGUE_SUB_ROUTES, extractLeagueContext, leagueSubHref } from "./leagueSubRoutes";

// Horizontal shortcut tabs under the header, desktop only — mirrors the
// same 8 routes the sidebar's league group links to (contextual shortcut,
// not separate navigation logic, per the approved plan).
export default function LeagueSubNavigation() {
  const pathname = usePathname();
  const ctx = extractLeagueContext(pathname);
  if (!ctx) return null;

  return (
    <nav className="mgrsubnav" aria-label="League sections">
      {LEAGUE_SUB_ROUTES.map((r) => {
        const href = leagueSubHref(ctx.leagueId, r.slug);
        const active = ctx.section === r.slug;
        return (
          <Link key={r.slug} href={href} className={`mgrsubnavlink ${active ? "on" : ""}`}>
            {r.label}
          </Link>
        );
      })}
    </nav>
  );
}
