"use client";

import { useEffect, useState } from "react";
import { formatUpcoming, statusChipStyle, type ManagedDraft, type ManagedLeague } from "@/lib/manager";
import LeagueIdentityBar from "./LeagueIdentityBar";
import { IconCalendar } from "./MgrIcons";
import { SectionHead } from "./PageHead";
import { DataTable, TableRow } from "./DataRow";

function settingsField(settings: unknown, key: string): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  return (settings as Record<string, unknown>)[key];
}

export default function LeagueDraftTab({
  league,
  draft,
}: {
  league: ManagedLeague;
  draft: ManagedDraft | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const draftId = settingsField(league.settings, "draft_id");

  return (
    <>
      <LeagueIdentityBar league={league} />
      <section className="sec">
        <SectionHead title="Draft" />
        {draft ? (
          <DataTable>
            <TableRow>
              <div className="mgrstaticon" style={statusChipStyle(league.status)}>
                <IconCalendar width={17} height={17} />
              </div>
              <span className="tname" style={{ flex: 1 }}>
                {mounted ? (draft.status === "drafting" ? "Drafting now" : formatUpcoming(draft.startTime)) : "—"}
              </span>
              {draft.type && <span className="portmeta">{draft.type}</span>}
              {typeof draftId === "string" && (
                <a className="link" href={`https://sleeper.com/draft/nfl/${draftId}`} target="_blank" rel="noreferrer">
                  Open draft →
                </a>
              )}
            </TableRow>
          </DataTable>
        ) : (
          <p className="hint">No draft synced yet for this league.</p>
        )}
      </section>
    </>
  );
}
