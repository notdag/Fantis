"use client";

import { useMemo, useState } from "react";
import { PLAYERS, POS_COLOR, posChipStyle } from "@/lib/players";
import { useTradeValues } from "@/lib/useTradeValues";
import { useAvailablePlayers } from "@/lib/useAvailablePlayers";
import { useProjections } from "@/lib/useProjections";
import { isRankedAdp } from "@/lib/sleeper";
import { stripSuffix } from "@/lib/playerIdMap";
import { computeTeamPower, POWER_POSITIONS } from "@/lib/teamPower";
import { computeByeImpact } from "@/lib/byeImpact";
import { buildStartingSlots } from "@/lib/rosterSlots";
import PlayerCard from "@/components/PlayerCard";
import type { LeagueBundle } from "@/lib/types";

interface OpenPlayer {
  id: string;
  adp: number | null;
  posRank: number | null;
  tier: number | null;
  value: number | null;
  poolSize: number;
}

type NavTarget = "rankings" | "trade" | "startsit" | "leagues";

// "Your team" digest shown above the full league board once a league is
// synced — one place that says what needs attention this week, with links
// into the tool that handles it, instead of making the user check four tabs.
export default function TeamHub({
  bundle,
  myUserId,
  onNavigate,
}: {
  bundle: LeagueBundle;
  myUserId: string | null;
  onNavigate: (tab: NavTarget) => void;
}) {
  const values = useTradeValues();
  const valuesLoading = Object.keys(values).length === 0;
  const { available, loading: waiversLoading } = useAvailablePlayers(bundle);
  const { projections } = useProjections();

  const myTeam = bundle.teams.find((t) => t.ownerId === myUserId) ?? null;

  // Same curated-list lookup LeagueView uses to open a player's card with
  // real ADP/tier/posRank/value attached, not just the bare Sleeper entry.
  const playerByName = useMemo(() => {
    const map: Record<string, (typeof PLAYERS)[number]> = {};
    for (const p of PLAYERS) map[p.name] = p;
    return map;
  }, []);
  const curatedPoolSize = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of PLAYERS) counts[p.pos] = (counts[p.pos] || 0) + 1;
    return counts;
  }, []);

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

  const teamPower = useMemo(() => computeTeamPower(bundle, values), [bundle, values]);
  const rankedTeams = useMemo(
    () =>
      [...bundle.teams].sort(
        (a, b) => (teamPower[b.rid]?.total ?? 0) - (teamPower[a.rid]?.total ?? 0)
      ),
    [bundle.teams, teamPower]
  );

  // Real current starters — Sleeper's own starters array, zipped against
  // this league's real slot order (bench excluded). Not a suggested/optimal
  // lineup like the bye-week planner below; this is whatever's actually
  // set on Sleeper right now.
  const myStarters = useMemo(() => {
    if (!myTeam) return [];
    return buildStartingSlots(bundle.rosterPositions).map((slot, i) => {
      const playerId = myTeam.starters[i];
      const entry = playerId && playerId !== "0" ? bundle.pmap[playerId] : undefined;
      return { slot, player: entry ? { ...entry, id: playerId } : null };
    });
  }, [bundle, myTeam]);

  const topWaiver = useMemo(
    () => [...available].sort((a, b) => (a.adp ?? 9999) - (b.adp ?? 9999))[0] ?? null,
    [available]
  );

  // The Waivers tab was merged into the Leagues page (it's just another
  // section below now, not a separate route) — onNavigate("leagues") is a
  // no-op here since TeamHub only ever renders while already on that tab.
  // Scroll to the real section instead of a dead tab-switch call.
  const goToWaivers = () => {
    onNavigate("leagues");
    document.getElementById("waivers-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const byeWeeks = useMemo(
    () => (valuesLoading || !myTeam ? [] : computeByeImpact(bundle, myTeam.players, values)),
    [bundle, myTeam, values, valuesLoading]
  );
  const activeWeek = byeWeeks.find((w) => w.week === selectedWeek) ?? byeWeeks[0] ?? null;

  if (!myTeam) return null;

  const myPower = teamPower[myTeam.rid];
  const myPlace = rankedTeams.findIndex((t) => t.rid === myTeam.rid) + 1;

  return (
    <div className="hub">
      {myStarters.length > 0 && (
        <div className="hubstarters">
          <div className="hubstartershead">Current Starters</div>
          <div className="hubstartercards">
            {myStarters.map(({ slot, player }) => (
              <div className="hubstartercard" key={slot.key}>
                <span className="hubcardslot">{slot.code}</span>
                {player ? (
                  <button
                    className="hubcardbtn"
                    onClick={() => openPlayerCard(player.id, player.n, player.p)}
                  >
                    <div className="hubcardphotowrap">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="hubcardphoto"
                        src={`https://sleepercdn.com/content/nfl/players/${player.id}.jpg`}
                        alt=""
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                        }}
                      />
                      <span className="pos hubcardpos" style={posChipStyle(player.p)}>
                        {player.p}
                      </span>
                    </div>
                    <span className="hubcardname">{player.n}</span>
                    <span className="hubcardteam">{player.t}</span>
                  </button>
                ) : (
                  <>
                    <div className="hubcardphotowrap empty" />
                    <span className="hubcardname" style={{ color: "var(--dim)" }}>
                      Empty
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="hubtop">
        {myTeam.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ava" src={myTeam.avatar} alt="" />
        ) : (
          <div className="ava" />
        )}
        <span className="tname">{myTeam.name}</span>
        {!valuesLoading && myPower && (
          <>
            <div className="trbar" style={{ maxWidth: 160 }}>
              {POWER_POSITIONS.map((pos) => (
                <div key={pos} style={{ background: POS_COLOR[pos] }}>
                  {myPower.rankByPos[pos] ?? "—"}
                </div>
              ))}
            </div>
            <span className="hubrank">
              #{myPlace} of {bundle.teams.length} · {Math.round(myPower.total)} pwr
            </span>
          </>
        )}
        {valuesLoading && <span className="hint" style={{ margin: 0 }}>Loading team strength…</span>}
      </div>

      {!waiversLoading && topWaiver && (
        <p className="hubwaiver">
          Top add on waivers: <b>{topWaiver.name}</b> ({topWaiver.pos}, ADP {topWaiver.adp ?? "—"}) —{" "}
          <button className="linklike" onClick={goToWaivers}>
            see waivers →
          </button>
        </p>
      )}

      <div className="hubactions">
        <button className="btn ghost sm" onClick={() => onNavigate("startsit")}>
          Set your lineup →
        </button>
        <button className="btn ghost sm" onClick={() => onNavigate("trade")}>
          Evaluate a trade →
        </button>
        <button className="btn ghost sm" onClick={() => onNavigate("rankings")}>
          Check rankings →
        </button>
      </div>

      {byeWeeks.length > 0 && (
        <div className="byeplanner">
          <div className="byeplannerhead">Bye Week Planner</div>
          <div className="byeweeks">
            {byeWeeks.map((w) => (
              <button
                key={w.week}
                className={`byeweek ${w.severity} ${activeWeek?.week === w.week ? "on" : ""}`}
                onClick={() => setSelectedWeek(w.week)}
              >
                <span className="byeweeknum">Wk {w.week}</span>
                <span className="byeweeklabel">
                  {w.severity === "severe" ? "Severe" : w.severity === "moderate" ? "Moderate" : "Covered"}
                </span>
              </button>
            ))}
          </div>

          {activeWeek && (
            <div className="byedetail">
              <div className="byedetailhead">
                Week {activeWeek.week} · {activeWeek.affected.length} starter
                {activeWeek.affected.length > 1 ? "s" : ""} on bye (best-lineup estimate)
              </div>
              {activeWeek.affected.map((a) => (
                <div className="byerow" key={a.slot.key}>
                  <span className="byeslot">{a.slot.label}</span>
                  <span className="byeplayer">
                    {a.player.name} <span style={{ color: "var(--dim)" }}>{a.player.team}</span>
                  </span>
                  <span className="byearrow">→</span>
                  {a.replacement ? (
                    <span className="byereplacement">
                      {a.replacement.name}{" "}
                      <span style={{ color: "var(--dim)" }}>{a.replacement.team}</span>
                    </span>
                  ) : (
                    <button className="byegap linklike" onClick={goToWaivers}>
                      No bench coverage — check waivers →
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {openPlayer && bundle.pmap[openPlayer.id] && (
        <PlayerCard
          id={openPlayer.id}
          entry={bundle.pmap[openPlayer.id]}
          adp={openPlayer.adp}
          posRank={openPlayer.posRank}
          tier={openPlayer.tier}
          value={openPlayer.value}
          poolSize={openPlayer.poolSize}
          onClose={() => setOpenPlayer(null)}
        />
      )}
    </div>
  );
}
