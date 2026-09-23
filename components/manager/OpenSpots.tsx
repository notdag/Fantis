"use client";

import { useEffect, useMemo, useState } from "react";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { EMPTY_PREFS, loadPrefs, type PlayerPrefs } from "@/lib/playerPrefs";
import { IconCheck, IconUsers } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";
import ConnectWriteAccess from "./ConnectWriteAccess";
import BulkAdd from "./BulkAdd";
import type { LineupLeague } from "./LineupManager";

export default function OpenSpots({ leagues }: { leagues: LineupLeague[] }) {
  const { pmap } = usePlayerMap();
  const [token, setToken] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PlayerPrefs>(EMPTY_PREFS);
  useEffect(() => {
    let cancelled = false;
    loadPrefs()
      .then((p) => { if (!cancelled) setPrefs(p); })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useMemo(
    () =>
      leagues
        .filter((l) => l.roster)
        .map((l) => {
          const limit = l.rosterPositions.length;
          const active = l.roster!.players.length - l.roster!.reserve.length;
          return { leagueId: l.league.id, leagueName: l.league.name, active, limit, spots: limit - active, league: l };
        })
        .filter((l) => l.spots > 0)
        .sort((a, b) => b.spots - a.spots || a.leagueName.localeCompare(b.leagueName)),
    [leagues]
  );
  const totalSpots = open.reduce((sum, l) => sum + l.spots, 0);
  const openLeagues = useMemo(() => open.map((l) => l.league), [open]);

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

      {open.length > 0 && (
        <section className="sec">
          <SectionHead
            title="Waiver a player into these leagues"
            right={`${open.length} league${open.length === 1 ? "" : "s"}, no drop needed`}
          />
          <ConnectWriteAccess onTokenReady={setToken} />
          <BulkAdd leagues={openLeagues} pmap={pmap} token={token} prefs={prefs} />
        </section>
      )}
    </>
  );
}
