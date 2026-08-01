"use client";

import { useEffect, useMemo, useState } from "react";
import { PLAYERS, TIER_COLOR, posChipStyle } from "@/lib/players";
import {
  currentProjectionWeek,
  getPlayers,
  getProjections,
  getState,
} from "@/lib/sleeper";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;

interface LiveStat {
  adp: number | null;
  proj: number | null;
}

type SortKey = "pos" | "adp" | "proj" | "value";
type SortDir = "asc" | "desc";

// Lower ADP is better (drafted earlier), so it defaults ascending; proj and
// value are "bigger is better", so they default descending. Pos defaults to
// roster order (QB, RB, WR, TE).
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  pos: "asc",
  adp: "asc",
  proj: "desc",
  value: "desc",
};

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

// Sleeper treats ~999+ as "outside the ranked player pool" for ADP.
const isRankedAdp = (adp: number | undefined): adp is number =>
  typeof adp === "number" && adp < 999;

const stripSuffix = (name: string) =>
  name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim();

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}) {
  const isOn = active === sortKey;
  return (
    <button className={`sorth ${isOn ? "on" : ""}`} onClick={() => onClick(sortKey)}>
      {label}
      {isOn && <span className="arrow">{dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}

export default function Rankings() {
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [live, setLive] = useState<Record<string, LiveStat>>({});
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState("");
  const [week, setWeek] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await getState();
        const wk = currentProjectionWeek(state);
        const [pmap, projections] = await Promise.all([
          getPlayers(),
          getProjections(state.season, wk),
        ]);
        if (cancelled) return;

        // Sleeper sometimes omits the suffix we carry in our curated list
        // (e.g. "Brian Thomas" vs. "Brian Thomas Jr."), so match exact name
        // first and fall back to a suffix-stripped comparison.
        const idByName: Record<string, string> = {};
        const idByBaseName: Record<string, string> = {};
        for (const id in pmap) {
          const n = pmap[id].n;
          idByName[n] = id;
          const base = stripSuffix(n);
          if (!(base in idByBaseName)) idByBaseName[base] = id;
        }

        const merged: Record<string, LiveStat> = {};
        for (const p of PLAYERS) {
          const id = idByName[p.name] || idByBaseName[stripSuffix(p.name)];
          const proj = id ? projections[id] : undefined;
          merged[p.name] = {
            adp: proj && isRankedAdp(proj.adp_dd_ppr) ? Math.round(proj.adp_dd_ppr) : null,
            proj: proj?.pts_ppr != null ? proj.pts_ppr : null,
          };
        }
        setLive(merged);
        setWeek(wk);
      } catch {
        if (!cancelled) setLiveError("Couldn't load live ADP/projections from Sleeper.");
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  };

  const list = useMemo(() => {
    const filtered = PLAYERS.filter((p) => pos === "ALL" || p.pos === pos);
    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sortBy === "pos") {
        const ai = POS_ORDER[a.pos] ?? 99;
        const bi = POS_ORDER[b.pos] ?? 99;
        if (ai !== bi) return (ai - bi) * dir;
        return b.value - a.value; // tiebreak within a position: higher value first
      }
      const av = sortBy === "value" ? a.value : live[a.name]?.[sortBy] ?? null;
      const bv = sortBy === "value" ? b.value : live[b.name]?.[sortBy] ?? null;
      // players missing a live stat always sort to the bottom, regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [pos, sortBy, sortDir, live]);

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Rankings</h2>
        <span className="rt">
          starter set · edit in code
          {week != null && ` · ADP & Week ${week} proj. via Sleeper`}
        </span>
      </div>
      <div className="filters">
        {POSITIONS.map((p) => (
          <button
            key={p}
            className={`chip-filter ${pos === p ? "on" : ""}`}
            onClick={() => setPos(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {liveLoading && <p className="hint">Loading live ADP & projections…</p>}
      {liveError && <p className="hint">{liveError}</p>}
      <div className="board">
        <div className="row rk head">
          <div className="cell">#</div>
          <div className="cell">Player</div>
          <div className="cell r">
            <SortHeader label="Pos" sortKey="pos" active={sortBy} dir={sortDir} onClick={toggleSort} />
          </div>
          <div className="cell r">
            <SortHeader label="ADP" sortKey="adp" active={sortBy} dir={sortDir} onClick={toggleSort} />
          </div>
          <div className="cell r">
            <SortHeader label="Proj" sortKey="proj" active={sortBy} dir={sortDir} onClick={toggleSort} />
          </div>
          <div className="cell r">
            <SortHeader label="Value" sortKey="value" active={sortBy} dir={sortDir} onClick={toggleSort} />
          </div>
        </div>
        {list.map((p, i) => {
          const stat = live[p.name];
          return (
            <div className="row rk" key={p.name}>
              <div className={`cell rank ${i < 3 ? "top" : ""}`}>{i + 1}</div>
              <div className="cell team">
                <span
                  className="tier"
                  style={{ background: TIER_COLOR[p.tier - 1] || "var(--oth)" }}
                  title={`Value tier ${p.tier}`}
                />
                <span className="tname">{p.name}</span>
                <span style={{ color: "var(--dim)", fontSize: 12, marginLeft: 8 }}>
                  {p.team}
                </span>
              </div>
              <div className="cell r">
                <span className="pos" style={posChipStyle(p.pos)}>
                  {p.pos}
                  {p.posRank}
                </span>
              </div>
              <div className="cell r num" style={{ color: "var(--muted)" }}>
                {stat?.adp != null ? stat.adp : "—"}
              </div>
              <div className="cell r num" style={{ color: "var(--muted)" }}>
                {stat?.proj != null ? stat.proj.toFixed(1) : "—"}
              </div>
              <div className="cell r val">{p.value}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
