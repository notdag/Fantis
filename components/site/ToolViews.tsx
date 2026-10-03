"use client";

import { useSite } from "@/components/SiteShell";
import Trade from "@/components/Trade";
import StartSit from "@/components/StartSit";
import Portfolio from "@/components/Portfolio";

// Thin wrappers that hand the shared synced-league state (kept in <SiteShell>) to each tool
// page. The tools themselves are unchanged.
export function TradeView() {
  const { sel, myUserId, go } = useSite();
  return <Trade sel={sel} myUserId={myUserId} onNavigate={go} />;
}

export function StartSitView() {
  const { sel, myUserId, leagues, selLoading, openLeague, go } = useSite();
  return (
    <StartSit
      sel={sel}
      myUserId={myUserId}
      leagues={leagues}
      selLoading={selLoading}
      onSelectLeague={openLeague}
      onGoToLeagues={() => go("leagues")}
    />
  );
}

export function PortfolioView() {
  const { leagues, myUserId, openLeague, go } = useSite();
  return (
    <Portfolio
      leagues={leagues}
      myUserId={myUserId}
      onGoToLeagues={() => go("leagues")}
      onOpenLeague={(lg) => {
        go("leagues");
        void openLeague(lg);
      }}
    />
  );
}
