"use client";

import { POS_COLOR } from "@/lib/players";
import { posRankColor } from "@/lib/rankColor";
import type { Team } from "@/lib/types";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

interface RosterPlayer {
  id: string;
  name: string;
  pos: string;
  team: string;
  adp: number | null;
  posRank: number | null;
  tier: number | null;
  value: number;
}

// Team scorecard — the same click-through modal pattern as PlayerCard, but
// for a team owner's name in the standings list. Reuses the player-card
// modal chrome (.modalbg/.modal/.pcardhead/.pcardstats) and the roster-column
// markup already built for the expanded team row (.trcols/.trcol/.trplayer),
// so it's real Sleeper standings/roster data, not a new data source.
export default function TeamCard({
  team,
  rank,
  totalTeams,
  powerScore,
  posRanks,
  byPos,
  curatedPoolSize,
  onOpenPlayer,
  onClose,
}: {
  team: Team;
  rank: number;
  totalTeams: number;
  powerScore: number;
  posRanks: Partial<Record<string, number>>;
  byPos: Record<string, RosterPlayer[]>;
  curatedPoolSize: Record<string, number>;
  onOpenPlayer: (id: string, name: string, pos: string) => void;
  onClose: () => void;
}) {
  const record = `${team.w}-${team.l}${team.t ? `-${team.t}` : ""}`;

  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="x modalclose" onClick={onClose}>
          ✕
        </button>
        <div className="pcardhead">
          {team.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="pcardphoto" src={team.avatar} alt="" />
          ) : (
            <div className="pcardphoto" />
          )}
          <div>
            <h3>{team.name}</h3>
            <div className="pcardmeta">
              <span>
                #{rank} of {totalTeams}
              </span>
              <span>{record}</span>
              <span>{Math.round(powerScore)} pwr</span>
            </div>
          </div>
        </div>

        <div className="pcardstats">
          <div>
            <span className="plabel">Record</span>
            <span className="pval">{record}</span>
          </div>
          <div>
            <span className="plabel">Points For</span>
            <span className="pval">{team.pf > 0 ? team.pf.toFixed(1) : "N/A"}</span>
          </div>
          <div>
            <span className="plabel">Points Against</span>
            <span className="pval">{team.pa > 0 ? team.pa.toFixed(1) : "N/A"}</span>
          </div>
          <div>
            <span className="plabel">Power Rank</span>
            <span className="pval" style={{ color: "var(--amber)" }}>
              #{rank}
            </span>
          </div>
        </div>

        <div className="trbar" style={{ height: 22, marginBottom: 24 }}>
          {POSITIONS.map((pos) => (
            <div key={pos} style={{ background: POS_COLOR[pos] }}>
              {pos} {posRanks[pos] ?? "—"}
            </div>
          ))}
        </div>

        <div className="trcols">
          {POSITIONS.map((pos) => (
            <div className="trcol" key={pos}>
              <header style={{ background: POS_COLOR[pos] }}>
                {pos} Rank
                <span className="badge">{posRanks[pos] ?? "—"}</span>
              </header>
              {byPos[pos].length === 0 && <div className="trempty">None rostered</div>}
              {byPos[pos].map((p) => (
                <div className="trplayer" key={p.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="trphoto"
                    src={`https://sleepercdn.com/content/nfl/players/${p.id}.jpg`}
                    alt=""
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  <span
                    className="plname"
                    style={{ cursor: "pointer" }}
                    onClick={() => onOpenPlayer(p.id, p.name, p.pos)}
                  >
                    {p.name}
                  </span>
                  {team.starters.includes(p.id) && <span className="tcstarter">Starting</span>}
                  <span className="nums">
                    <span style={{ color: "var(--dim)" }}>{p.adp ?? "—"}</span>
                    <span style={{ color: posRankColor(p.posRank, curatedPoolSize[pos] ?? 0) }}>
                      {p.posRank ?? "—"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 14 }}>
          Real Sleeper standings and roster data. Power rank and position ranks
          compare this team&rsquo;s roster value (season projection + this
          week&rsquo;s market delta) against the rest of the league. Not
          investment or betting advice.
        </p>
      </div>
    </div>
  );
}
