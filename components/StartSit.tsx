"use client";

import { useState } from "react";
import { posChipStyle } from "@/lib/players";
import { isRankedAdp } from "@/lib/sleeper";
import { useProjections } from "@/lib/useProjections";
import type { LeagueBundle } from "@/lib/types";

interface RosterPlayer {
  id: string;
  name: string;
  pos: string;
  team: string;
}

interface Stat {
  adp: number | null;
  proj: number | null;
}

export default function StartSit({
  sel,
  myUserId,
  onGoToLeagues,
}: {
  sel: LeagueBundle | null;
  myUserId: string | null;
  onGoToLeagues: () => void;
}) {
  const { projections, week, loading, error } = useProjections();
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);

  if (!sel) {
    return (
      <section className="sec">
        <div className="sechead">
          <h2>Start / Sit</h2>
        </div>
        <p className="hint">
          This compares two players on your own roster — open a league first.
        </p>
        <button className="btn ghost sm" onClick={onGoToLeagues} style={{ marginTop: 10 }}>
          Go to Leagues →
        </button>
      </section>
    );
  }

  const myTeam = sel.teams.find((t) => t.ownerId === myUserId);

  if (!myTeam) {
    return (
      <section className="sec">
        <div className="sechead">
          <h2>Start / Sit</h2>
        </div>
        <p className="hint">Couldn&rsquo;t find your team in {sel.lg.name}.</p>
      </section>
    );
  }

  const roster: RosterPlayer[] = myTeam.players
    .map((id) => {
      const p = sel.pmap[id];
      return p ? { id, name: p.n, pos: p.p, team: p.t } : null;
    })
    .filter((p): p is RosterPlayer => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const playerA = roster.find((p) => p.id === aId) || null;
  const playerB = roster.find((p) => p.id === bId) || null;

  const statFor = (id: string | null): Stat | null => {
    if (!id || !projections) return null;
    const p = projections[id];
    if (!p) return null;
    return {
      adp: isRankedAdp(p.adp_dd_ppr) ? Math.round(p.adp_dd_ppr) : null,
      proj: p.pts_ppr != null ? p.pts_ppr : null,
    };
  };

  const statA = statFor(aId);
  const statB = statFor(bId);

  let verdict: { winner: "A" | "B"; basis: "proj" | "adp"; diff: number } | null = null;
  if (playerA && playerB) {
    if (statA?.proj != null && statB?.proj != null) {
      verdict = {
        winner: statA.proj >= statB.proj ? "A" : "B",
        basis: "proj",
        diff: Math.abs(statA.proj - statB.proj),
      };
    } else if (statA?.adp != null && statB?.adp != null) {
      verdict = {
        winner: statA.adp <= statB.adp ? "A" : "B",
        basis: "adp",
        diff: Math.abs(statA.adp - statB.adp),
      };
    }
  }

  const pa = statA?.proj ?? 0;
  const pb = statB?.proj ?? 0;
  const total = pa + pb || 1;
  const barA = Math.round((pa / total) * 100);
  const barB = 100 - barA;

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Start / Sit</h2>
        <span className="rt">
          {myTeam.name}
          {week != null && ` · Week ${week} proj. via Sleeper`}
        </span>
      </div>
      {loading && <p className="hint">Loading live projections…</p>}
      {error && <p className="hint">{error}</p>}

      <div className="trade">
        <PlayerSlot
          title="Player A"
          accent="var(--mint)"
          roster={roster}
          excludeId={bId}
          selected={playerA}
          onSelect={setAId}
          onClear={() => setAId(null)}
          stat={statA}
        />
        <div style={{ alignSelf: "center", textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--dim)" }}>VS</div>
        </div>
        <PlayerSlot
          title="Player B"
          accent="var(--amber)"
          roster={roster}
          excludeId={aId}
          selected={playerB}
          onSelect={setBId}
          onClear={() => setBId(null)}
          stat={statB}
        />
      </div>

      {playerA && playerB && (
        <div className="verdict" style={{ maxWidth: 640, margin: "22px auto 0" }}>
          {verdict?.basis === "proj" && (
            <>
              <div className="vbar">
                <div className="vfill" style={{ width: `${barA}%`, background: "var(--mint)" }} />
                <div className="vfill" style={{ width: `${barB}%`, background: "var(--amber)" }} />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 8,
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                <span className="num">
                  {playerA.name} · {pa.toFixed(1)}
                </span>
                <span className="num">
                  {pb.toFixed(1)} · {playerB.name}
                </span>
              </div>
              <div
                className="vlabel"
                style={{ color: verdict.winner === "A" ? "var(--mint)" : "var(--amber)" }}
              >
                Start {verdict.winner === "A" ? playerA.name : playerB.name}
                {verdict.diff >= 1 ? ` (+${verdict.diff.toFixed(1)} pts)` : " — toss-up"}
              </div>
            </>
          )}
          {verdict?.basis === "adp" && (
            <div className="vlabel" style={{ color: "var(--muted)", fontSize: 15 }}>
              Start {verdict.winner === "A" ? playerA.name : playerB.name} — earlier ADP (
              {verdict.winner === "A" ? statA?.adp : statB?.adp} vs.{" "}
              {verdict.winner === "A" ? statB?.adp : statA?.adp}), no live projection for
              either yet
            </div>
          )}
          {!verdict && (
            <div className="vlabel" style={{ color: "var(--muted)", fontSize: 15 }}>
              Not enough live data for either player yet — check back closer to kickoff.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PlayerSlot({
  title,
  accent,
  roster,
  excludeId,
  selected,
  onSelect,
  onClear,
  stat,
}: {
  title: string;
  accent: string;
  roster: RosterPlayer[];
  excludeId: string | null;
  selected: RosterPlayer | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  stat: Stat | null;
}) {
  const [q, setQ] = useState("");
  const matches =
    q.trim().length < 1
      ? []
      : roster
          .filter((p) => p.id !== excludeId && p.name.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 8);

  return (
    <div className="side">
      <h4 style={{ color: accent }}>{title}</h4>
      {selected ? (
        <div className="picked">
          <span className="pos" style={posChipStyle(selected.pos)}>
            {selected.pos}
          </span>
          <span className="plname">{selected.name}</span>
          <span style={{ marginLeft: "auto", color: "var(--dim)", fontSize: 12 }}>
            {selected.team}
          </span>
          <button className="x" onClick={onClear}>
            ✕
          </button>
        </div>
      ) : (
        <div className="search">
          <input
            className="input"
            placeholder="Search your roster…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%" }}
          />
          {matches.length > 0 && (
            <div className="results">
              {matches.map((p) => (
                <div
                  className="res"
                  key={p.id}
                  onClick={() => {
                    onSelect(p.id);
                    setQ("");
                  }}
                >
                  <span className="pos" style={posChipStyle(p.pos)}>
                    {p.pos}
                  </span>
                  <span className="plname">{p.name}</span>
                  <span style={{ marginLeft: "auto", color: "var(--dim)" }}>{p.team}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {selected && (
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 13, color: "var(--muted)" }}>
          <span>
            ADP <b style={{ color: "var(--bone)" }}>{stat?.adp ?? "—"}</b>
          </span>
          <span>
            Proj{" "}
            <b style={{ color: "var(--bone)" }}>{stat?.proj != null ? stat.proj.toFixed(1) : "—"}</b>
          </span>
        </div>
      )}
    </div>
  );
}
