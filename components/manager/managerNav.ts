// Nav data + active-route logic shared by the sidebar (ManagerShell.tsx)
// and its mobile-drawer/collapsed-rail-flyout variants — one source of
// truth instead of three copies. Same 3 real route groups + Today
// established in the earlier navigation-cleanup increment (previously
// lived in MgrTabs.tsx, which this replaces); every href here is a real,
// working route with real data — nothing added for pages that don't
// exist yet (Standings/Draft Results/Settings).
export type IconKey = "home" | "users" | "wrench" | "shield" | "search" | "check" | "flag";

export type NavEntry =
  | { kind: "link"; icon: IconKey; label: string; href: string }
  | { kind: "group"; icon: IconKey; label: string; links: { href: string; label: string }[] };

export const NAV_ENTRIES: NavEntry[] = [
  { kind: "link", icon: "home", label: "Command Center", href: "/manager" },
  // Command Center 2.0 grouping: League Manager (work across leagues), Player Operations (work on one player
  // everywhere), Review Queue (everything waiting for you), Intelligence (read-only analysis). Every previous
  // destination is still here — nothing was removed, only regrouped.
  {
    kind: "group",
    icon: "users",
    label: "League Manager",
    links: [
      { href: "/manager/teams", label: "All leagues" },
      { href: "/manager/lineups", label: "Lineups & weekly planner" },
      { href: "/manager/open-spots", label: "Empty roster spots" },
      { href: "/manager/matchups", label: "Matchups" },
      
      
      
      
    ],
  },
  {
    kind: "group",
    icon: "search",
    label: "Player Operations",
    links: [
      { href: "/manager/player", label: "Find a player" },
      { href: "/manager/waiver", label: "Waivers & adds" },
    ],
  },
  {
    kind: "group",
    icon: "check",
    label: "Review Queue",
    links: [
      { href: "/manager/review", label: "Review queue" },
      { href: "/manager/inbox", label: "Trades & claims" },
      { href: "/manager/actions", label: "Alerts" },
    ],
  },
  {
    kind: "group",
    icon: "flag",
    label: "Intelligence",
    links: [
      { href: "/manager/record", label: "Weekly record" },
      { href: "/manager/leaguemates", label: "LeagueMates" },
      { href: "/manager/transactions", label: "Transactions" },
      { href: "/manager/history", label: "History" },
      { href: "/manager/activity", label: "Activity log" },
    ],
  },
];

export function isActive(pathname: string, href: string) {
  return href === "/manager" ? pathname === "/manager" : pathname.startsWith(href);
}
