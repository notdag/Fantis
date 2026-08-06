"use client";

import { useEffect, useMemo, useState } from "react";
import { PLAYERS, POS_COLOR, posChipStyle } from "@/lib/players";
import { isRankedAdp } from "@/lib/sleeper";
import { useProjections } from "@/lib/useProjections";
import { useTradeValues } from "@/lib/useTradeValues";
import { useAvailablePlayers } from "@/lib/useAvailablePlayers";
import { stripSuffix } from "@/lib/playerIdMap";
import { adpColor, posRankColor } from "@/lib/rankColor";
import PlayerCard from "@/components/PlayerCard";
import type { LeagueBundle, Team } from "@/lib/types";

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
  const name = (id: string) => pmap[id]?.n ?? id;
  const posOf = (id: string) => pmap[id]?.p ?? "";
  const teamOf = (id: string) => pmap[id]?.t ?? "";

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

  // League-relative strength rank per position (1 = strongest), from the
  // summed value of each team's roster at that position.
  const posRanksByTeam = useMemo(() => {
    const out: Record<number, Record<string, number>> = {};
    for (const pos of POSITIONS) {
      const scored = teams.map((t) => ({
        rid: t.rid,
        score: teamRosters[t.rid]?.[pos]?.reduce((s, p) => s + p.value, 0) ?? 0,
      }));
      scored.sort((a, b) => b.score - a.score);
      scored.forEach((s, i) => {
        (out[s.rid] ??= {})[pos] = i + 1;
      });
    }
    return out;
  }, [teams, teamRosters]);

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

  const [openRid, setOpenRid] = useState<number | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      const mine = teams.find((t) => t.ownerId === myUserId);
      setOpenRid((mine ?? teams[0])?.rid ?? null);
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
          {teams.map((t, i) => {
            const open = openRid === t.rid;
            const ranks = posRanksByTeam[t.rid] ?? {};
            const byPos = teamRosters[t.rid] ?? { QB: [], RB: [], WR: [], TE: [] };
            const record = `${t.w}-${t.l}${t.t ? `-${t.t}` : ""}`;
            return (
              <div className="trrow" key={t.rid}>
                <button
                  className="trhead"
                  onClick={() => setOpenRid(open ? null : t.rid)}
                >
                  <span className="rk">{i + 1}.</span>
                  {t.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="ava" src={t.avatar} alt="" />
                  ) : (
                    <div className="ava" />
                  )}
                  <span className="tname">{t.name}</span>
                  <span className={`chev ${open ? "open" : ""}`}>▼</span>
                </button>
                {open && (
                  <div className="trbody">
                    <div className="trbar">
                      {POSITIONS.map((pos) => (
                        <div key={pos} style={{ background: POS_COLOR[pos] }}>
                          {ranks[pos] ?? "—"}
                        </div>
                      ))}
                    </div>
                    <div className="trmeta">
                      <span>
                        <b>Record</b>
                        {record}
                      </span>
                      <span>
                        <b>Points For</b>
                        {t.pf > 0 ? t.pf.toFixed(1) : "—"}
                      </span>
                      <span>
                        <b>Points Against</b>
                        {t.pa > 0 ? t.pa.toFixed(1) : "—"}
                      </span>
                    </div>
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
                              <span
                                className="plname"
                                style={{ cursor: "pointer" }}
                                onClick={() => openPlayerCard(p.id, p.name, p.pos)}
                              >
                                {p.name}
                              </span>
                              <span className="nums">
                                <span style={{ color: adpColor(p.adp) }}>{p.adp ?? "—"}</span>
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
                              <span style={{ color: adpColor(p.adp) }}>{p.adp ?? "—"}</span>
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
          Position ranks compare each team&rsquo;s roster value (season projection
          + this week&rsquo;s market delta) at that position against the rest of
          the league. Two numbers per player are ADP and position rank, both
          live from Sleeper/our own rankings. Players outside the curated list
          aren&rsquo;t counted toward a team&rsquo;s value. Not investment or
          betting advice.
        </p>
      </section>

      <section className="sec">
        <div className="sechead">
          <h2>Rosters</h2>
          <span className="rt">starters listed first</span>
        </div>
        <div className="rosters">
          {teams.map((t: Team) => {
            const bench = t.players.filter((p) => !t.starters.includes(p));
            const Line = ({ id }: { id: string }) => (
              <div className="pl">
                <span className="pos" style={posChipStyle(posOf(id))}>
                  {posOf(id) || "—"}
                </span>
                <span
                  className="plname"
                  style={{ cursor: "pointer" }}
                  onClick={() => openPlayerCard(id, name(id), posOf(id))}
                >
                  {name(id)}
                </span>
                <span className="plteam">{teamOf(id)}</span>
              </div>
            );
            return (
              <div className="rteam" key={t.rid}>
                <header>
                  {t.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="ava" src={t.avatar} alt="" />
                  ) : (
                    <div className="ava" />
                  )}
                  <b>{t.name}</b>
                  <span className="rec">
                    {t.w}-{t.l}
                  </span>
                </header>
                <div className="divlbl">Starters</div>
                {t.starters.filter(Boolean).map((id, k) => (
                  <Line key={"s" + k} id={id} />
                ))}
                {bench.length > 0 && <div className="divlbl">Bench</div>}
                {bench.map((id, k) => (
                  <Line key={"b" + k} id={id} />
                ))}
              </div>
            );
          })}
        </div>
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
