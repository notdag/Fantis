"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { buildStartingSlots } from "@/lib/rosterSlots";
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

function Side({
  playerId,
  points,
  pmap,
  align,
}: {
  playerId: string | undefined;
  points: number | undefined;
  pmap: PlayerMap | null;
  align: "left" | "right";
}) {
  const empty = !playerId || playerId === "0";
  if (empty) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, justifyContent: align === "left" ? "flex-start" : "flex-end" }}>
        <span className="tname" style={{ color: "var(--red)" }}>Empty slot</span>
      </div>
    );
  }
  const entry = pmap?.[playerId];
  const content = (
    <>
      <Avatar playerId={playerId} pos={entry?.p} size={26} />
      <div>
        <div className="mgrplayername">{entry?.n ?? playerId}</div>
        {entry?.p && (
          <span className="pos" style={posChipStyle(entry.p)}>
            {entry.p}
          </span>
        )}
      </div>
      <span className="portvalue" style={{ minWidth: 42 }}>{points != null ? points.toFixed(1) : "—"}</span>
    </>
  );
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexDirection: align === "left" ? "row" : "row-reverse",
        justifyContent: align === "left" ? "flex-start" : "flex-end",
        textAlign: align,
      }}
    >
      {content}
    </div>
  );
}

export default function MatchupDetail({
  leagueId,
  leagueName,
  week,
  myPoints,
  myStarters,
  myStartersPoints,
  opponentTeamName,
  opponentPoints,
  opponentStarters,
  opponentStartersPoints,
  rosterPositions,
}: {
  leagueId: string;
  leagueName: string;
  week: number;
  myPoints: number;
  myStarters: string[];
  myStartersPoints: number[];
  opponentTeamName: string | null;
  opponentPoints: number | null;
  opponentStarters: string[];
  opponentStartersPoints: number[];
  rosterPositions: string[];
}) {
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

  const slots = buildStartingSlots(rosterPositions);
  const leading = opponentPoints != null ? myPoints - opponentPoints : null;

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h1>Week {week} matchup</h1>
            <Link href={`/manager/${leagueId}`} className="link">
              ← {leagueName}
            </Link>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, padding: "12px 0 20px" }}>
          <div style={{ textAlign: "center" }}>
            <div className="tname" style={{ fontSize: 15 }}>You</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: leading != null && leading > 0 ? "var(--mint)" : "var(--bone)" }}>
              {myPoints.toFixed(1)}
            </div>
          </div>
          <div className="hint" style={{ margin: 0 }}>vs</div>
          <div style={{ textAlign: "center" }}>
            <div className="tname" style={{ fontSize: 15 }}>{opponentTeamName ?? "Opponent"}</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: leading != null && leading < 0 ? "var(--mint)" : "var(--bone)" }}>
              {opponentPoints != null ? opponentPoints.toFixed(1) : "—"}
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sechead">
          <h2 style={{ fontSize: 18 }}>Starters</h2>
          <span className="rt">who started who</span>
        </div>
        <div className="mgrtable">
          {slots.map((slot, i) => (
            <div className="mgrrow static" key={slot.key}>
              <Side playerId={myStarters[i]} points={myStartersPoints[i]} pmap={pmap} align="left" />
              <span className="portmeta" style={{ minWidth: 44, textAlign: "center" }}>{slot.code}</span>
              <Side playerId={opponentStarters[i]} points={opponentStartersPoints[i]} pmap={pmap} align="right" />
            </div>
          ))}
          {slots.length === 0 && <p className="hint" style={{ padding: 16 }}>No roster format synced for this league yet.</p>}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Points shown are real, from Sleeper&rsquo;s own weekly scoring — 0.0 before kickoff, live
          once games start.
        </p>
      </section>
    </>
  );
}
