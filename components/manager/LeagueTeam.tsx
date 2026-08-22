"use client";

import { useEffect, useState } from "react";
import { formatRelative, type ManagedLeague, type ManagedRoster } from "@/lib/manager";
import { posChipStyle } from "@/lib/players";
import { buildStartingSlots } from "@/lib/rosterSlots";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { useFantasyCalcValues, fantasyCalcValue, type FantasyCalcMaps } from "@/lib/fantasyCalc";
import { PlayerAvatar } from "./Avatar";
import LeagueIdentityBar from "./LeagueIdentityBar";
import { SectionHead } from "./PageHead";
import { DataTable, TableRow, TableRowSkeleton } from "./DataRow";
import type { PlayerMap } from "@/lib/types";

function playerLabel(pmap: PlayerMap | null, id: string) {
  const entry = pmap?.[id];
  if (!entry) return { name: id, pos: "", team: "", inj: null as string | null };
  return { name: entry.n, pos: entry.p, team: entry.t, inj: entry.inj ?? null };
}

function RosterSection({
  roster,
  pmap,
  pmapLoading,
  fcValues,
  rosterPositions,
}: {
  roster: ManagedRoster;
  pmap: PlayerMap | null;
  pmapLoading: boolean;
  fcValues: FantasyCalcMaps | null;
  rosterPositions: string[];
}) {
  const slots = buildStartingSlots(rosterPositions);
  const ir = roster.reserve;
  const bench = roster.players.filter(
    (id) => !roster.starters.includes(id) && !roster.reserve.includes(id)
  );

  if (pmapLoading) {
    return <DataTable><TableRowSkeleton count={slots.length} /></DataTable>;
  }

  return (
    <DataTable>
      {slots.map((slot, i) => {
        const playerId = roster.starters[i];
        const empty = !playerId || playerId === "0";
        const label = empty ? null : playerLabel(pmap, playerId);
        const fc = label && fcValues ? fantasyCalcValue(fcValues, { name: label.name, pos: label.pos }) : 0;
        return (
          <TableRow key={slot.key}>
            <span className="portmeta" style={{ minWidth: 44 }}>
              {slot.code}
            </span>
            {empty ? (
              <span className="tname" style={{ color: "var(--red)" }}>
                Empty slot
              </span>
            ) : (
              <>
                <PlayerAvatar playerId={playerId} pos={label!.pos} size={26} />
                <span className="tname" style={{ flex: 1 }}>{label!.name}</span>
                {label!.pos && (
                  <span className="pos" style={posChipStyle(label!.pos)}>
                    {label!.pos}
                  </span>
                )}
                {label!.inj && /out|doubtful|ir/i.test(label!.inj) && (
                  <span className="portmeta" style={{ color: "var(--red)" }}>
                    {label!.inj}
                  </span>
                )}
                <span className="portmeta" title="FantasyCalc value">FC {fc > 0 ? Math.round(fc) : "—"}</span>
              </>
            )}
          </TableRow>
        );
      })}
      {bench.length > 0 && (
        <TableRow style={{ opacity: 0.85 }}>
          <span className="tname">Bench</span>
          <span className="portmeta">
            {bench.map((id) => playerLabel(pmap, id).name).join(", ")}
          </span>
        </TableRow>
      )}
      {ir.length > 0 && (
        <TableRow style={{ opacity: 0.85 }}>
          <span className="tname">IR</span>
          <span className="portmeta">
            {ir.map((id) => playerLabel(pmap, id).name).join(", ")}
          </span>
        </TableRow>
      )}
    </DataTable>
  );
}

export default function LeagueTeam({
  league,
  roster,
  rosterPositions,
}: {
  league: ManagedLeague;
  roster: ManagedRoster | null;
  rosterPositions: string[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { pmap, loading: pmapLoading, error: pmapError, retry: retryPmap } = usePlayerMap();
  const fcValues = useFantasyCalcValues();

  return (
    <>
      <LeagueIdentityBar league={league} />
      {roster ? (
        <section className="sec">
          <SectionHead
            title="My roster"
            right={`${roster.waiverPosition != null ? `waiver #${roster.waiverPosition} · ` : ""}${roster.faabUsed != null ? `$${roster.faabUsed} FAAB used · ` : ""}synced ${mounted ? formatRelative(roster.lastSyncedAt) : "—"}`}
          />
          {pmapError ? (
            <p className="hint">
              Couldn&rsquo;t load player data.{" "}
              <button type="button" className="link" onClick={retryPmap}>
                Retry
              </button>
            </p>
          ) : (
            <RosterSection roster={roster} pmap={pmap} pmapLoading={pmapLoading} fcValues={fcValues} rosterPositions={rosterPositions} />
          )}
        </section>
      ) : (
        <section className="sec">
          <p className="hint">No roster synced yet for this league.</p>
        </section>
      )}
    </>
  );
}
