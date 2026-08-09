"use client";

import { useMemo, useState } from "react";
import { POS_COLOR } from "@/lib/players";
import { useTradeValues } from "@/lib/useTradeValues";
import { useAvailablePlayers } from "@/lib/useAvailablePlayers";
import { computeTeamPower, POWER_POSITIONS } from "@/lib/teamPower";
import { computeByeImpact } from "@/lib/byeImpact";
import type { LeagueBundle } from "@/lib/types";

type NavTarget = "rankings" | "trade" | "startsit" | "waivers";

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

  const myTeam = bundle.teams.find((t) => t.ownerId === myUserId) ?? null;

  const teamPower = useMemo(() => computeTeamPower(bundle, values), [bundle, values]);
  const rankedTeams = useMemo(
    () =>
      [...bundle.teams].sort(
        (a, b) => (teamPower[b.rid]?.total ?? 0) - (teamPower[a.rid]?.total ?? 0)
      ),
    [bundle.teams, teamPower]
  );

  const topWaiver = useMemo(
    () => [...available].sort((a, b) => (a.adp ?? 9999) - (b.adp ?? 9999))[0] ?? null,
    [available]
  );

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
          <button className="linklike" onClick={() => onNavigate("waivers")}>
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
                    <button className="byegap linklike" onClick={() => onNavigate("waivers")}>
                      No bench coverage — check waivers →
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
