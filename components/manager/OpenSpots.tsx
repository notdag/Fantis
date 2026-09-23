"use client";

import { useMemo } from "react";
import { IconCheck, IconUsers } from "./MgrIcons";
import { PageHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";

export interface OpenSpotLeague {
  leagueId: string;
  leagueName: string;
  active: number; // real roster count, IR excluded
  limit: number; // real roster_positions length (starters + bench)
}

export default function OpenSpots({ leagues }: { leagues: OpenSpotLeague[] }) {
  const open = useMemo(
    () =>
      leagues
        .map((l) => ({ ...l, spots: l.limit - l.active }))
        .filter((l) => l.spots > 0)
        .sort((a, b) => b.spots - a.spots || a.leagueName.localeCompare(b.leagueName)),
    [leagues]
  );
  const totalSpots = open.reduce((sum, l) => sum + l.spots, 0);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          description={
            <>
              Every in-season league where your active roster (IR excluded) isn&rsquo;t full —
              a waiver add there wouldn&rsquo;t need a drop first.
            </>
          }
        />
        <StatCardGrid variant="hero">
          <StatCard
            icon={IconUsers}
            color={open.length > 0 ? "var(--mint)" : "var(--muted)"}
            label="Leagues with an open spot"
            value={open.length}
            valueColor={open.length > 0 ? "var(--mint)" : undefined}
            sub={`of ${leagues.length} scanned`}
          />
          <StatCard icon={IconCheck} color="var(--muted)" label="Total open spots" value={totalSpots} />
        </StatCardGrid>
      </section>

      <section className="sec">
        {leagues.length === 0 ? (
          <p className="hint">No in-season leagues synced yet.</p>
        ) : open.length === 0 ? (
          <p className="hint">Every roster is full right now — nothing to add without a drop.</p>
        ) : (
          <DataTable>
            {open.map((l) => (
              <TableRow as="link" href={`/manager/${l.leagueId}`} key={l.leagueId}>
                <span className="tname" style={{ flex: 1 }}>{l.leagueName}</span>
                <span className="portmeta">{l.active}/{l.limit} filled</span>
                <span className="portmeta" style={{ color: "var(--mint)", fontWeight: 600, minWidth: 70, textAlign: "right" }}>
                  {l.spots} open
                </span>
              </TableRow>
            ))}
          </DataTable>
        )}
      </section>
    </>
  );
}
