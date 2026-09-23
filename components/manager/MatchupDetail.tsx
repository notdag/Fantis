"use client";

import Link from "next/link";
import { posChipStyle } from "@/lib/players";
import { buildStartingSlots } from "@/lib/rosterSlots";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { PlayerAvatar } from "./Avatar";
import { TableRowSkeleton } from "./DataRow";
import type { PlayerMap } from "@/lib/types";

function Side({
  playerId,
  points,
  projected,
  pmap,
  align,
}: {
  playerId: string | undefined;
  points: number | undefined;
  projected: number | undefined;
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
      <PlayerAvatar playerId={playerId} pos={entry?.p} size={26} />
      <div>
        <div className="mgrplayername">{entry?.n ?? playerId}</div>
        {entry?.p && (
          <span className="pos" style={posChipStyle(entry.p)}>
            {entry.p}
          </span>
        )}
      </div>
      <div style={{ minWidth: 42, textAlign: "center" }}>
        <span className="portvalue" style={{ display: "block" }}>{points != null ? points.toFixed(1) : "—"}</span>
        {projected != null && (
          <span className="portmeta" style={{ fontSize: 11 }}>proj {projected.toFixed(1)}</span>
        )}
      </div>
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
  myProjPoints,
  myStartersProjPoints,
  opponentTeamName,
  opponentPoints,
  opponentStarters,
  opponentStartersPoints,
  opponentProjPoints,
  opponentStartersProjPoints,
  rosterPositions,
}: {
  leagueId: string;
  leagueName: string;
  week: number;
  myPoints: number;
  myStarters: string[];
  myStartersPoints: number[];
  myProjPoints: number | null;
  myStartersProjPoints: number[];
  opponentTeamName: string | null;
  opponentPoints: number | null;
  opponentStarters: string[];
  opponentStartersPoints: number[];
  opponentProjPoints: number | null;
  opponentStartersProjPoints: number[];
  rosterPositions: string[];
}) {
  const { pmap, loading: pmapLoading, error: pmapError, retry: retryPmap } = usePlayerMap();

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
            {myProjPoints != null && (
              <div className="hint" style={{ margin: 0 }}>proj {myProjPoints.toFixed(1)}</div>
            )}
          </div>
          <div className="hint" style={{ margin: 0 }}>vs</div>
          <div style={{ textAlign: "center" }}>
            <div className="tname" style={{ fontSize: 15 }}>{opponentTeamName ?? "Opponent"}</div>
            <div style={{ fontSize: 32, fontWeight: 800, color: leading != null && leading < 0 ? "var(--mint)" : "var(--bone)" }}>
              {opponentPoints != null ? opponentPoints.toFixed(1) : "—"}
            </div>
            {opponentProjPoints != null && (
              <div className="hint" style={{ margin: 0 }}>proj {opponentProjPoints.toFixed(1)}</div>
            )}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sechead">
          <h2 style={{ fontSize: 18 }}>Starters</h2>
          <span className="rt">who started who</span>
        </div>
        {pmapError ? (
          <p className="hint">
            Couldn&rsquo;t load player data.{" "}
            <button type="button" className="link" onClick={retryPmap}>
              Retry
            </button>
          </p>
        ) : (
          <div className="mgrtable">
            {pmapLoading ? (
              <TableRowSkeleton count={slots.length || 3} />
            ) : (
              <>
                {slots.map((slot, i) => (
                  <div className="mgrrow static" key={slot.key}>
                    <Side
                      playerId={myStarters[i]}
                      points={myStartersPoints[i]}
                      projected={myStartersProjPoints[i]}
                      pmap={pmap}
                      align="left"
                    />
                    <span className="portmeta" style={{ minWidth: 44, textAlign: "center" }}>{slot.code}</span>
                    <Side
                      playerId={opponentStarters[i]}
                      points={opponentStartersPoints[i]}
                      projected={opponentStartersProjPoints[i]}
                      pmap={pmap}
                      align="right"
                    />
                  </div>
                ))}
                {slots.length === 0 && <p className="hint" style={{ padding: 16 }}>No roster format synced for this league yet.</p>}
              </>
            )}
          </div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          Points shown are real, from Sleeper&rsquo;s own weekly scoring — 0.0 before kickoff, live
          once games start. Proj figures are Sleeper&rsquo;s own weekly projection (the same feed
          used for season trade value elsewhere in the app), not a Fantis-computed estimate.
        </p>
      </section>
    </>
  );
}
