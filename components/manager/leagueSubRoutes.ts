// Shared "am I inside a league?" detection + the 8-way league sub-route
// list — used by ManagerHeader, the sidebar's CurrentLeagueNavGroup,
// LeagueSubNavigation, and BottomNavBar so they all agree on the same
// routes from one source of truth (same reasoning as managerNav.ts for
// the portfolio-level nav).
export const LEAGUE_SUB_ROUTES = [
  { slug: "overview", label: "Overview" },
  { slug: "team", label: "My Team" },
  { slug: "matchup", label: "Matchup" },
  { slug: "rosters", label: "Rosters" },
  { slug: "standings", label: "Standings" },
  { slug: "transactions", label: "Transactions" },
  { slug: "draft", label: "Draft" },
  { slug: "info", label: "Info" },
] as const;

// Top-level portfolio routes that live directly under /manager/<slug> —
// used to tell "/manager/teams" (portfolio) apart from "/manager/<leagueId>"
// (league-scoped), since both are a single path segment after /manager.
const PORTFOLIO_SLUGS = new Set([
  "teams",
  "matchups",
  "byes",
  "injuries",
  "actions",
  "waiver",
  "player",
  "drafts",
  "transactions",
  "commissioner",
  "history",
]);

export interface LeagueRouteContext {
  leagueId: string;
  section: string;
}

export function extractLeagueContext(pathname: string): LeagueRouteContext | null {
  const parts = pathname.split("/").filter(Boolean); // ["manager", leagueId?, section?]
  if (parts[0] !== "manager" || !parts[1]) return null;
  if (PORTFOLIO_SLUGS.has(parts[1])) return null;
  return { leagueId: parts[1], section: parts[2] ?? "overview" };
}

export function leagueSubHref(leagueId: string, slug: string): string {
  return `/manager/${leagueId}/${slug}`;
}
