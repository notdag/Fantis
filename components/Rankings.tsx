"use client";

import { useEffect, useMemo, useState } from "react";
import { PLAYERS, TIER_COLOR, posChipStyle } from "@/lib/players";
import { getPlayers, isRankedAdp } from "@/lib/sleeper";
import { useProjections } from "@/lib/useProjections";
import SortHeader from "@/components/SortHeader";

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

const stripSuffix = (name: string) =>
  name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim();

// Fixed rank by our own value, independent of the table's current sort —
// this is what "vs ADP" compares against, so it doesn't shift as you sort.
const VALUE_RANK: Record<string, number> = {};
[...PLAYERS]
  .sort((a, b) => b.value - a.value)
  .forEach((p, i) => (VALUE_RANK[p.name] = i + 1));

export default function Rankings() {
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [live, setLive] = useState<Record<string, LiveStat>>({});
  const [sortBy, setSortBy] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<string | null>(null);
  const { projections, week, loading: liveLoading, error: liveError } = useProjections();

  useEffect(() => {
    if (!projections) return;
    let cancelled = false;
    (async () => {
      const pmap = await getPlayers();
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
    })();
    return () => {
      cancelled = true;
    };
  }, [projections]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = PLAYERS.filter(
      (p) => (pos === "ALL" || p.pos === pos) && (!q || p.name.toLowerCase().includes(q))
    );
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
  }, [pos, query, sortBy, sortDir, live]);

  // vs ADP: our fixed value-rank minus Sleeper's real ADP. Positive means we
  // have them ranked earlier than the market (a "riser" in our book), negative
  // means the market likes them more than we do.
  const vsAdp = (name: string, adp: number | null) => {
    if (adp == null) return null;
    return adp - VALUE_RANK[name];
  };

  const selectedPlayer = selected ? PLAYERS.find((p) => p.name === selected) || null : null;
  const selectedStat = selectedPlayer ? live[selectedPlayer.name] : undefined;
  const selectedDelta = selectedPlayer ? vsAdp(selectedPlayer.name, selectedStat?.adp ?? null) : null;

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Rankings</h2>
        <span className="rt">
          starter set · edit in code
          {week != null && ` · ADP & Week ${week} proj. via Sleeper`}
        </span>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <input
          className="input"
          placeholder="Search players…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 280 }}
        />
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

      <div className={`rankgrid ${selectedPlayer ? "split" : ""}`}>
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
            <div className="cell r">vs ADP</div>
            <div className="cell r">
              <SortHeader label="Proj" sortKey="proj" active={sortBy} dir={sortDir} onClick={toggleSort} />
            </div>
            <div className="cell r">
              <SortHeader label="Value" sortKey="value" active={sortBy} dir={sortDir} onClick={toggleSort} />
            </div>
          </div>
          {list.length === 0 && <p className="hint" style={{ padding: "12px 4px" }}>No players match.</p>}
          {list.map((p, i) => {
            const stat = live[p.name];
            const delta = vsAdp(p.name, stat?.adp ?? null);
            return (
              <div
                className={`row rk rowclick ${selected === p.name ? "on" : ""}`}
                key={p.name}
                onClick={() => setSelected(selected === p.name ? null : p.name)}
              >
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
                <div
                  className="cell r num"
                  style={{
                    color: delta == null || delta === 0 ? "var(--dim)" : delta > 0 ? "var(--mint)" : "var(--red)",
                  }}
                >
                  {delta == null ? "—" : delta === 0 ? "–" : delta > 0 ? `↑${delta}` : `↓${-delta}`}
                </div>
                <div className="cell r num" style={{ color: "var(--muted)" }}>
                  {stat?.proj != null ? stat.proj.toFixed(1) : "—"}
                </div>
                <div className="cell r val">{p.value}</div>
              </div>
            );
          })}
        </div>

        {selectedPlayer && (
          <div className="panel">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <h3>{selectedPlayer.name}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span className="pos" style={posChipStyle(selectedPlayer.pos)}>
                    {selectedPlayer.pos}
                    {selectedPlayer.posRank}
                  </span>
                  <span style={{ color: "var(--dim)", fontSize: 13 }}>{selectedPlayer.team}</span>
                </div>
              </div>
              <button className="x" onClick={() => setSelected(null)}>
                ✕
              </button>
            </div>

            <div className="prow">
              <span className="plabel">Value</span>
              <span className="pval">{selectedPlayer.value}</span>
            </div>
            <div className="prow">
              <span className="plabel">Tier</span>
              <span className="pval" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  className="tier"
                  style={{ background: TIER_COLOR[selectedPlayer.tier - 1] || "var(--oth)", margin: 0 }}
                />
                {selectedPlayer.tier}
              </span>
            </div>
            <div className="prow">
              <span className="plabel">ADP</span>
              <span className="pval">{selectedStat?.adp ?? "—"}</span>
            </div>
            <div className="prow">
              <span className="plabel">vs ADP</span>
              <span
                className="pval"
                style={{
                  color:
                    selectedDelta == null || selectedDelta === 0
                      ? "var(--dim)"
                      : selectedDelta > 0
                        ? "var(--mint)"
                        : "var(--red)",
                }}
              >
                {selectedDelta == null
                  ? "—"
                  : selectedDelta === 0
                    ? "even with market"
                    : selectedDelta > 0
                      ? `↑${selectedDelta} spots ahead of market`
                      : `↓${-selectedDelta} spots behind market`}
              </span>
            </div>
            <div className="prow">
              <span className="plabel">{week != null ? `Week ${week} Proj` : "Proj"}</span>
              <span className="pval">{selectedStat?.proj != null ? selectedStat.proj.toFixed(1) : "—"}</span>
            </div>

            <div className="foot">
              Value/tier are Fantis&rsquo; own starter rankings. ADP and projected points are
              live from Sleeper&rsquo;s public API — not investment or betting advice.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
