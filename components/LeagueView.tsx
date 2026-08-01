"use client";

import { posChipStyle } from "@/lib/players";
import type { LeagueBundle } from "@/lib/types";

export default function LeagueView({
  bundle,
  onBack,
}: {
  bundle: LeagueBundle;
  onBack: () => void;
}) {
  const { lg, teams, pmap } = bundle;
  const name = (id: string) => pmap[id]?.n ?? id;
  const posOf = (id: string) => pmap[id]?.p ?? "";
  const teamOf = (id: string) => pmap[id]?.t ?? "";

  return (
    <>
      <section className="sec">
        <div className="sechead">
          <h2>{lg.name}</h2>
          <button className="btn ghost sm" onClick={onBack}>
            ← All leagues
          </button>
        </div>
        <div className="board">
          <div className="row stand head">
            <div className="cell">#</div>
            <div className="cell">Team</div>
            <div className="cell r">W-L</div>
            <div className="cell r">PF</div>
            <div className="cell r">Record</div>
          </div>
          {teams.map((t, i) => (
            <div className="row stand" key={t.rid}>
              <div className={`cell rank ${i < 1 ? "top" : ""}`}>{i + 1}</div>
              <div className="cell team">
                {t.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="ava" src={t.avatar} alt="" />
                ) : (
                  <div className="ava" />
                )}
                <span className="tname">{t.name}</span>
              </div>
              <div className="cell r num">
                {t.w}-{t.l}
                {t.t ? `-${t.t}` : ""}
              </div>
              <div className="cell r num pts">{t.pf.toFixed(1)}</div>
              <div className="cell r num" style={{ color: "var(--muted)" }}>
                {t.w + t.l + t.t > 0
                  ? `${Math.round((100 * t.w) / (t.w + t.l + t.t))}%`
                  : "—"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sec">
        <div className="sechead">
          <h2>Rosters</h2>
          <span className="rt">starters listed first</span>
        </div>
        <div className="rosters">
          {teams.map((t) => {
            const bench = t.players.filter((p) => !t.starters.includes(p));
            const Line = ({ id }: { id: string }) => (
              <div className="pl">
                <span className="pos" style={posChipStyle(posOf(id))}>
                  {posOf(id) || "—"}
                </span>
                <span className="plname">{name(id)}</span>
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
    </>
  );
}
