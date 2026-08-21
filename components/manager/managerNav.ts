// Nav data + active-route logic shared by the sidebar (ManagerShell.tsx)
// and its mobile-drawer/collapsed-rail-flyout variants — one source of
// truth instead of three copies. Same 3 real route groups + Today
// established in the earlier navigation-cleanup increment (previously
// lived in MgrTabs.tsx, which this replaces); every href here is a real,
// working route with real data — nothing added for pages that don't
// exist yet (Standings/Draft Results/Settings).
export type IconKey = "home" | "users" | "wrench" | "shield";

export type NavEntry =
  | { kind: "link"; icon: IconKey; label: string; href: string }
  | { kind: "group"; icon: IconKey; label: string; links: { href: string; label: string }[] };

export const NAV_ENTRIES: NavEntry[] = [
  { kind: "link", icon: "home", label: "Today", href: "/manager" },
  {
    kind: "group",
    icon: "users",
    label: "My Teams",
    links: [
      { href: "/manager/teams", label: "My Teams" },
      { href: "/manager/matchups", label: "Matchups" },
      { href: "/manager/byes", label: "Byes" },
      { href: "/manager/injuries", label: "Injuries" },
    ],
  },
  {
    kind: "group",
    icon: "wrench",
    label: "Tools",
    links: [
      { href: "/manager/actions", label: "Action Queue" },
      { href: "/manager/waiver", label: "Waiver Assistant" },
      { href: "/manager/player", label: "Player search" },
    ],
  },
  {
    kind: "group",
    icon: "shield",
    label: "League Ops",
    links: [
      { href: "/manager/drafts", label: "Drafts" },
      { href: "/manager/transactions", label: "Transactions" },
      { href: "/manager/commissioner", label: "Commissioner" },
      { href: "/manager/history", label: "History" },
    ],
  },
];

export function isActive(pathname: string, href: string) {
  return href === "/manager" ? pathname === "/manager" : pathname.startsWith(href);
}
