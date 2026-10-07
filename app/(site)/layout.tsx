import SiteShell from "@/components/SiteShell";

// Shared by every public tab (/, /leagues, /rankings, /trade, /start-sit, /portfolio). Next keeps
// layouts mounted across navigations, so the synced Sleeper league survives moving between tabs.
// /admin and /manager are outside this group and keep their own shells.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
