"use client";

import { useEffect, useState } from "react";
import { formatRelative, type ManagedLeague, type ManagedRoster } from "@/lib/manager";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { buildStartingSlots } from "@/lib/rosterSlots";
import LeagueIdentityBar from "./LeagueIdentityBar";
import type { PlayerMap } from "@/lib/types";

function Avatar({ playerId, pos, size }: { playerId: string; pos?: string; size: number }) {
  const ring = pos ? posChipStyle(pos).color : "var(--line)";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="mgravatar"
      src={playerPhotoUrl(playerId)}
      alt=""
      style={{ width: size, height: size, borderColor: ring }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

function playerLabel(pmap: PlayerMap | null, id: string) {
  const entry = pmap?.[id];
  if (!entry) return { name: id, pos: "", team: "", inj: null as string | null };
  return { name: entry.n, pos: entry.p, team: entry.t, inj: entry.inj ?? null };
}

function RosterSection({
  roster,
  pmap,
  rosterPositions,
}: {
  roster: ManagedRoster;
  pmap: PlayerMap | null;
  rosterPositions: string[];
}) {
  const slots = buildStartingSlots(rosterPositions);
  const ir = roster.reserve;
  const bench = roster.players.filter(
    (id) => !roster.starters.includes(id) && !roster.reserve.includes(id)
  );

  return (
    <div className="mgrtable">
      {slots.map((slot, i) => {
        const playerId = roster.starters[i];
        const empty = !playerId || playerId === "0";
        const label = empty ? null : playerLabel(pmap, playerId);
        return (
          <div className="mgrrow static" key={slot.key}>
            <span className="portmeta" style={{ minWidth: 44 }}>
              {slot.code}
            </span>
            {empty ? (
              <span className="tname" style={{ color: "var(--red)" }}>
                Empty slot
              </span>
            ) : (
              <>
                <Avatar playerId={playerId} pos={label!.pos} size={26} />
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
              </>
            )}
          </div>
        );
      })}
      {bench.length > 0 && (
        <div className="mgrrow static" style={{ opacity: 0.85 }}>
          <span className="tname">Bench</span>
          <span className="portmeta">
            {bench.map((id) => playerLabel(pmap, id).name).join(", ")}
          </span>
        </div>
      )}
      {ir.length > 0 && (
        <div className="mgrrow static" style={{ opacity: 0.85 }}>
          <span className="tname">IR</span>
          <span className="portmeta">
            {ir.map((id) => playerLabel(pmap, id).name).join(", ")}
          </span>
        </div>
      )}
    </div>
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

  const [pmap, setPmap] = useState<PlayerMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPlayers()
      .then((m) => {
        if (!cancelled) setPmap(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <LeagueIdentityBar league={league} />
      {roster ? (
        <section className="sec">
          <div className="sechead">
            <h2 style={{ fontSize: 18 }}>My roster</h2>
            <span className="rt">
              {roster.waiverPosition != null ? `waiver #${roster.waiverPosition} · ` : ""}
              {roster.faabUsed != null ? `$${roster.faabUsed} FAAB used · ` : ""}synced{" "}
              {mounted ? formatRelative(roster.lastSyncedAt) : "—"}
            </span>
          </div>
          <RosterSection roster={roster} pmap={pmap} rosterPositions={rosterPositions} />
        </section>
      ) : (
        <section className="sec">
          <p className="hint">No roster synced yet for this league.</p>
        </section>
      )}
    </>
  );
}
