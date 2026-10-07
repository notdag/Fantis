"use client";

import { useEffect, useState } from "react";
import { formatRelative, type ManagedLeague } from "@/lib/manager";
import LeagueIdentityBar from "./LeagueIdentityBar";

function settingsField(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}

// Read-only league info + sync status — was a collapsible panel inside the
// old single-page LeagueDetail.tsx, now its own route. Deliberately NOT
// called "Settings": the only real write path here is Fantis's own group
// label (edited from LeagueIdentityBar), not actual Sleeper league config,
// which is read-only display (see prisma/schema.prisma's League.settings).
export default function LeagueInfoTab({ league }: { league: ManagedLeague }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const previousLeagueId = settingsField(league.settings, "previous_league_id");

  return (
    <>
      <LeagueIdentityBar league={league} />
      <section className="sec">
        <div className="portsummary">
          <div className="portcard">
            <div className="portcardhead">League</div>
            <div className="portcardrows">
              <div className="portcardrow">
                <span>League ID</span>
                <b>{league.id}</b>
              </div>
              <div className="portcardrow">
                <span>Season</span>
                <b>{league.season}</b>
              </div>
              <div className="portcardrow">
                <span>Teams</span>
                <b>{league.totalRosters}</b>
              </div>
              <div className="portcardrow">
                <span>Connected via</span>
                <b>{league.accountUsername}</b>
              </div>
              {typeof previousLeagueId === "string" && (
                <div className="portcardrow">
                  <span>Previous season</span>
                  <b>{previousLeagueId}</b>
                </div>
              )}
            </div>
          </div>

          <div className="portcard">
            <div className="portcardhead">Sync</div>
            <div className="portcardrows">
              <div className="portcardrow">
                <span>Last synced</span>
                <b>{mounted ? formatRelative(league.lastSyncedAt) : "—"}</b>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
