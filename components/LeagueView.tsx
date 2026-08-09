"use client";

import { useEffect, useMemo, useState } from "react";
import { PLAYERS, POS_COLOR, posChipStyle } from "@/lib/players";
import { isRankedAdp } from "@/lib/sleeper";
import { useProjections } from "@/lib/useProjections";
import { useTradeValues } from "@/lib/useTradeValues";
import { useAvailablePlayers } from "@/lib/useAvailablePlayers";
import { stripSuffix } from "@/lib/playerIdMap";
import { posRankColor } from "@/lib/rankColor";
import { computeTeamPower } from "@/lib/teamPower";
import PlayerCard from "@/components/PlayerCard";
import type { LeagueBundle } from "@/lib/types";

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

interface OpenPlayer {
  id: string;
  adp: number | null;
  posRank: number | null;
  tier: number | null;
  value: number | null;
  poolSize: number;
}

export default function LeagueView({
  bundle,
  myUserId,
  onBack,
}: {
  bundle: LeagueBundle;
  myUserId: string | null;
  onBack: () => void;
}) {
  const { lg, teams, pmap } = bundle;

  const { projections } = useProjections();
  const values = useTradeValues();
  const valuesLoading = Object.keys(values).length === 0;
  const { available } = useAvailablePlayers(bundle);

  const playerByName = useMemo(() => {
    const map: Record<string, (typeof PLAYERS)[number]> = {};
    for (const p of PLAYERS) map[p.name] = p;
    return map;
  }, []);

  // How many players are curated at each position — position rank color
  // bands scale to this so a shallow position (TE) and a deep one (RB) both
  // get a meaningful top/middle/bottom split. See lib/rankColor.ts.
  const curatedPoolSize = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of PLAYERS) counts[p.pos] = (counts[p.pos] || 0) + 1;
    return counts;
  }, []);
  const availablePoolSize = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of available) counts[p.pos] = (counts[p.pos] || 0) + 1;
    return counts;
  }, [available]);

  // Each team's roster (bench included) grouped by position, with live ADP
  // (Sleeper) and posRank/value (our curated list) attached where we have a
  // match — same trade value used in Trade/Rankings, see lib/tradeValue.ts.
  const teamRosters = useMemo(() => {
    const byTeam: Record<number, Record<string, RosterPlayer[]>> = {};
    for (const t of teams) {
      const byPos: Record<string, RosterPlayer[]> = { QB: [], RB: [], WR: [], TE: [] };
      for (const id of t.players) {
        const p = pmap[id];
        if (!p || !(p.p in byPos)) continue;
        const curated = playerByName[p.n] ?? playerByName[stripSuffix(p.n)];
        const val = values[p.n] ?? values[stripSuffix(p.n)];
        const proj = projections?.[id];
        byPos[p.p].push({
          id,
          name: p.n,
          pos: p.p,
          team: p.t,
          adp: proj && isRankedAdp(proj.adp_dd_ppr) ? Math.round(proj.adp_dd_ppr) : null,
          posRank: curated?.posRank ?? null,
          tier: curated?.tier ?? null,
          value: val?.value ?? 0,
        });
      }
      for (const pos of POSITIONS) {
        byPos[pos].sort((a, b) => (a.posRank ?? 999) - (b.posRank ?? 999));
      }
      byTeam[t.rid] = byPos;
    }
    return byTeam;
  }, [teams, pmap, playerByName, values, projections]);

  // League-relative strength rank per position (1 = strongest) and each
  // team's total power score, from the summed trade value of each team's
  // roster — shared with TeamHub so both agree on what "strong" means.
  const teamPower = useMemo(() => computeTeamPower(bundle, values), [bundle, values]);

  // Real roster-strength total per team — what the section actually ranks
  // on, so the displayed "1./2./..." order matches the power score shown
  // per team instead of in-season win/loss record (meaningless before/early
  // in the season, when every team is still 0-0).
  const rankedTeams = useMemo(
    () =>
      [...teams].sort(
        (a, b) => (teamPower[b.rid]?.total ?? 0) - (teamPower[a.rid]?.total ?? 0)
      ),
    [teams, teamPower]
  );

  const topWaivers = useMemo(
    () =>
      [...available]
        .sort((a, b) => (a.adp ?? 9999) - (b.adp ?? 9999))
        .slice(0, 10),
    [available]
  );

  const [openPlayer, setOpenPlayer] = useState<OpenPlayer | null>(null);
  const openPlayerCard = (id: string, playerName: string, pos: string) => {
    const curated = playerByName[playerName] ?? playerByName[stripSuffix(playerName)];
    const val = values[playerName] ?? values[stripSuffix(playerName)];
    const proj = projections?.[id];
    setOpenPlayer({
      id,
      adp: proj && isRankedAdp(proj.adp_dd_ppr) ? Math.round(proj.adp_dd_ppr) : null,
      posRank: curated?.posRank ?? null,
      tier: curated?.tier ?? null,
      value: val?.value ?? null,
      poolSize: curatedPoolSize[pos] ?? 0,
    });
  };

  const [openRids, setOpenRids] = useState<Set<number>>(new Set());
  const toggleTeam = (rid: number) => {
    setOpenRids((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
  };
  useEffect(() => {
    const id = setTimeout(() => {
      const mine = teams.find((t) => t.ownerId === myUserId);
      const rid = (mine ?? teams[0])?.rid;
      setOpenRids(rid != null ? new Set([rid]) : new Set());
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lg.league_id]);

  return (
    <>
      <section className="sec">
        <div className="sechead">
          <h2>{lg.name}</h2>
          <button className="btn ghost sm" onClick={onBack}>
            ← All leagues
          </button>
        </div>
        {valuesLoading && (
          <p className="hint" style={{ marginBottom: 10 }}>
            Loading player values…
          </p>
        )}
        <div className="teamranks">
          {rankedTeams.map((t, i) => {
            const open = openRids.has(t.rid);
            const ranks = teamPower[t.rid]?.rankByPos ?? {};
            const byPos = teamRosters[t.rid] ?? { QB: [], RB: [], WR: [], TE: [] };
            const record = `${t.w}-${t.l}${t.t ? `-${t.t}` : ""}`;
            const powerScore = teamPower[t.rid]?.total ?? 0;
            return (
              <div className="trrow" key={t.rid}>
                <button className="trtop" onClick={() => toggleTeam(t.rid)}>
                  <span className="rk">{i + 1}.</span>
                  {t.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="ava" src={t.avatar} alt="" />
                  ) : (
                    <div className="ava" />
                  )}
                  <span className="tname">{t.name}</span>
                  <div className="trbar">
                    {POSITIONS.map((pos) => (
                      <div key={pos} style={{ background: POS_COLOR[pos] }}>
                        {ranks[pos] ?? "—"}
                      </div>
                    ))}
                  </div>
                  <span className={`chev ${open ? "open" : ""}`}>▼</span>
                </button>
                <div className="trbottom">
                  <span className="trscore">{Math.round(powerScore)}</span>
                  <span className="trranktext">
                    {POSITIONS.map((pos) => (
                      <span key={pos} style={{ color: POS_COLOR[pos] }}>
                        {pos}
                        {ranks[pos] ?? "—"}
                      </span>
                    ))}
                  </span>
                  <span className="trmeta">
                    <span>
                      <b>Record</b>
                      {record}
                    </span>
                    <span>
                      <b>Points For</b>
                      {t.pf > 0 ? t.pf.toFixed(1) : "N/A"}
                    </span>
                    <span>
                      <b>Points Against</b>
                      {t.pa > 0 ? t.pa.toFixed(1) : "N/A"}
                    </span>
                  </span>
                </div>
                {open && (
                  <div className="trbody">
                    <div className="trcols">
                      {POSITIONS.map((pos) => (
                        <div className="trcol" key={pos}>
                          <header style={{ background: POS_COLOR[pos] }}>
                            {pos} Rank
                            <span className="badge">{ranks[pos] ?? "—"}</span>
                          </header>
                          {byPos[pos].length === 0 && (
                            <div className="trempty">None rostered</div>
                          )}
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
                                onClick={() => openPlayerCard(p.id, p.name, p.pos)}
                              >
                                {p.name}
                              </span>
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
                      <div className="trcol">
                        <header style={{ background: "var(--amber)" }}>Waivers</header>
                        {topWaivers.length === 0 && (
                          <div className="trempty">None available</div>
                        )}
                        {topWaivers.map((p) => (
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
                            <span className="pos" style={{ ...posChipStyle(p.pos), flex: "none" }}>
                              {p.pos}
                            </span>
                            <span
                              className="plname"
                              style={{ cursor: "pointer" }}
                              onClick={() => openPlayerCard(p.id, p.name, p.pos)}
                            >
                              {p.name}
                            </span>
                            <span className="nums">
                              <span style={{ color: "var(--dim)" }}>{p.adp ?? "—"}</span>
                              <span style={{ color: posRankColor(p.wireRank, availablePoolSize[p.pos] ?? 0) }}>
                                {p.wireRank}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Teams are ordered by total roster power score (top number), not
          win/loss record — the two can differ, especially before the
          season&rsquo;s underway. Position ranks compare each team&rsquo;s roster value (season projection
          + this week&rsquo;s market delta) at that position against the rest of
          the league. Two numbers per player are ADP and position rank, both
          live from Sleeper/our own rankings. Players outside the curated list
          aren&rsquo;t counted toward a team&rsquo;s value. Not investment or
          betting advice.
        </p>
      </section>

      {openPlayer && pmap[openPlayer.id] && (
        <PlayerCard
          id={openPlayer.id}
          entry={pmap[openPlayer.id]}
          adp={openPlayer.adp}
          posRank={openPlayer.posRank}
          tier={openPlayer.tier}
          value={openPlayer.value}
          poolSize={openPlayer.poolSize}
          onClose={() => setOpenPlayer(null)}
        />
      )}
    </>
  );
}
