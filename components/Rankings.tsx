"use client";

import { useEffect, useMemo, useState } from "react";
import { PLAYERS, TIER_COLOR, posChipStyle } from "@/lib/players";
import { getPlayers, getSeasonProjectionTotals, isRankedAdp } from "@/lib/sleeper";
import { useProjections } from "@/lib/useProjections";
import { getMvpOdds, type MvpOddsEntry } from "@/lib/sharpapi";
import SortHeader from "@/components/SortHeader";
import type { SeasonProjectionTotal } from "@/lib/types";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;

interface LiveStat {
  adp: number | null;
  proj: number | null;
}

type ProjMode = "week" | "season";
type SortKey = "pos" | "adp" | "proj" | "rushYd" | "recYd" | "passYd" | "td";
type SortDir = "asc" | "desc";

// Lower ADP is better (drafted earlier), so it defaults ascending; everything
// else is "bigger is better", so it defaults descending. Pos defaults to
// roster order (QB, RB, WR, TE).
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  pos: "asc",
  adp: "asc",
  proj: "desc",
  rushYd: "desc",
  recYd: "desc",
  passYd: "desc",
  td: "desc",
};

// Which sort columns are visible in each mode — used to reset sortBy to
// something sensible when switching modes away from a column that's about
// to disappear.
const WEEK_KEYS: SortKey[] = ["pos", "adp", "proj"];
const SEASON_KEYS: SortKey[] = ["pos", "rushYd", "recYd", "passYd", "td", "proj"];

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

const stripSuffix = (name: string) =>
  name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim();

// Position-scoped lookup — see the id-map build effect below for why
// position has to be part of the key.
const sleeperId = (
  maps: { byName: Record<string, string>; byBase: Record<string, string> },
  p: { name: string; pos: string }
) => maps.byName[`${p.name}|${p.pos}`] || maps.byBase[`${stripSuffix(p.name)}|${p.pos}`];

export default function Rankings() {
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("pos");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<string | null>(null);
  const [projMode, setProjMode] = useState<ProjMode>("season");

  const [idMaps, setIdMaps] = useState<{
    byName: Record<string, string>;
    byBase: Record<string, string>;
  } | null>(null);

  const [seasonTotals, setSeasonTotals] = useState<Record<
    string,
    SeasonProjectionTotal
  > | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonProgress, setSeasonProgress] = useState(0);
  const [seasonError, setSeasonError] = useState("");

  const [mvpOdds, setMvpOdds] = useState<Record<string, MvpOddsEntry>>({});

  const {
    projections,
    week,
    season,
    loading: liveLoading,
    error: liveError,
  } = useProjections();

  // Resolve Sleeper player IDs for our curated list once, independent of week.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pmap = await getPlayers();
      if (cancelled) return;
      // Sleeper sometimes omits the suffix we carry in our curated list
      // (e.g. "Brian Thomas" vs. "Brian Thomas Jr."), so match exact name
      // first and fall back to a suffix-stripped comparison. Position is
      // included in both keys: several names collide with an unrelated
      // player elsewhere in Sleeper's ~11k-player dump (e.g. two "Lamar
      // Jackson"s — the Ravens QB and an inactive CB; two "Kenneth
      // Walker"s — the real RB and an unrelated WR). Matching by name alone
      // silently picked whichever one happened to appear later in the dump,
      // which was frequently the wrong, data-empty player.
      const byName: Record<string, string> = {};
      const byBase: Record<string, string> = {};
      for (const id in pmap) {
        const entry = pmap[id];
        byName[`${entry.n}|${entry.p}`] = id;
        const baseKey = `${stripSuffix(entry.n)}|${entry.p}`;
        if (!(baseKey in byBase)) byBase[baseKey] = id;
      }
      setIdMaps({ byName, byBase });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // MVP futures — separate provider (SharpAPI via our own /api/mvp-odds
  // proxy), keyed directly by player name. Not every player has a line, so
  // failures here shouldn't block the rest of the page.
  useEffect(() => {
    let cancelled = false;
    getMvpOdds()
      .then((odds) => {
        if (!cancelled) setMvpOdds(odds);
      })
      .catch(() => {
        // MVP odds are a bonus panel stat, not core to the page — fail quietly
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const live = useMemo(() => {
    const merged: Record<string, LiveStat> = {};
    if (!projections || !idMaps) return merged;
    for (const p of PLAYERS) {
      const id = sleeperId(idMaps, p);
      const proj = id ? projections[id] : undefined;
      merged[p.name] = {
        adp: proj && isRankedAdp(proj.adp_dd_ppr) ? Math.round(proj.adp_dd_ppr) : null,
        proj: proj?.pts_ppr != null ? proj.pts_ppr : null,
      };
    }
    return merged;
  }, [projections, idMaps]);

  const seasonLive = useMemo(() => {
    const merged: Record<string, SeasonProjectionTotal | undefined> = {};
    if (!seasonTotals || !idMaps) return merged;
    for (const p of PLAYERS) {
      const id = sleeperId(idMaps, p);
      merged[p.name] = id ? seasonTotals[id] : undefined;
    }
    return merged;
  }, [seasonTotals, idMaps]);

  const loadSeason = async () => {
    if (!season || seasonLoading || seasonTotals) return;
    setSeasonLoading(true);
    setSeasonError("");
    setSeasonProgress(0);
    try {
      const totals = await getSeasonProjectionTotals(season, (done) => setSeasonProgress(done));
      setSeasonTotals(totals);
    } catch {
      setSeasonError("Couldn't load season totals from Sleeper.");
    } finally {
      setSeasonLoading(false);
    }
  };

  const setMode = (mode: ProjMode) => {
    setProjMode(mode);
    if (mode === "season") loadSeason();
    const valid = mode === "season" ? SEASON_KEYS : WEEK_KEYS;
    if (!valid.includes(sortBy)) {
      setSortBy("proj");
      setSortDir(DEFAULT_DIR.proj);
    }
  };

  // Season is the default view, so kick off the (heavy, 18-week) fetch as
  // soon as we know which season we're in — don't wait for a click. Deferred
  // to a timeout so the state updates inside loadSeason don't fire
  // synchronously within the effect body.
  useEffect(() => {
    if (projMode !== "season" || !season) return;
    const id = setTimeout(() => loadSeason(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

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
        return a.posRank - b.posRank; // tiebreak within a position: better rank first
      }
      let av: number | null;
      let bv: number | null;
      if (sortBy === "proj") {
        av = projMode === "season" ? seasonLive[a.name]?.pts ?? null : live[a.name]?.proj ?? null;
        bv = projMode === "season" ? seasonLive[b.name]?.pts ?? null : live[b.name]?.proj ?? null;
      } else if (sortBy === "rushYd") {
        av = seasonLive[a.name]?.rushYd ?? null;
        bv = seasonLive[b.name]?.rushYd ?? null;
      } else if (sortBy === "recYd") {
        av = seasonLive[a.name]?.recYd ?? null;
        bv = seasonLive[b.name]?.recYd ?? null;
      } else if (sortBy === "passYd") {
        av = seasonLive[a.name]?.passYd ?? null;
        bv = seasonLive[b.name]?.passYd ?? null;
      } else if (sortBy === "td") {
        const as = seasonLive[a.name];
        const bs = seasonLive[b.name];
        av = as ? as.passTd + as.rushTd + as.recTd : null;
        bv = bs ? bs.passTd + bs.rushTd + bs.recTd : null;
      } else {
        av = live[a.name]?.adp ?? null;
        bv = live[b.name]?.adp ?? null;
      }
      // players missing a live stat always sort to the bottom, regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [pos, query, sortBy, sortDir, live, seasonLive, projMode]);

  const selectedPlayer = selected ? PLAYERS.find((p) => p.name === selected) || null : null;
  const selectedStat = selectedPlayer ? live[selectedPlayer.name] : undefined;
  const selectedSeason = selectedPlayer ? seasonLive[selectedPlayer.name] : undefined;
  const selectedMvp = selectedPlayer
    ? mvpOdds[selectedPlayer.name] || mvpOdds[stripSuffix(selectedPlayer.name)]
    : undefined;

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Rankings</h2>
        <span className="rt">
          starter set · edit in code
          {week != null && ` · ADP via Sleeper`}
        </span>
      </div>
      <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
        <input
          className="input"
          placeholder="Search players…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <button className={`chip-filter ${projMode === "week" ? "on" : ""}`} onClick={() => setMode("week")}>
          This Week
        </button>
        <button
          className={`chip-filter ${projMode === "season" ? "on" : ""}`}
          onClick={() => setMode("season")}
        >
          Season Total
        </button>
        {projMode === "season" && seasonLoading && (
          <span className="hint" style={{ margin: 0 }}>
            Loading season projections… (week {seasonProgress}/18)
          </span>
        )}
        {projMode === "season" && seasonError && (
          <span className="hint" style={{ margin: 0, color: "var(--red)" }}>
            {seasonError}
          </span>
        )}
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
          <div className={`row rk ${projMode === "season" ? "rk-season" : ""} head`}>
            <div className="cell">#</div>
            <div className="cell">Player</div>
            <div className="cell r">
              <SortHeader label="Pos" sortKey="pos" active={sortBy} dir={sortDir} onClick={toggleSort} />
            </div>
            {projMode === "week" ? (
              <>
                <div className="cell r">
                  <SortHeader label="ADP" sortKey="adp" active={sortBy} dir={sortDir} onClick={toggleSort} />
                </div>
                <div className="cell r">
                  <SortHeader label="Proj" sortKey="proj" active={sortBy} dir={sortDir} onClick={toggleSort} />
                </div>
              </>
            ) : (
              <>
                <div className="cell r">
                  <SortHeader label="Rush Yd" sortKey="rushYd" active={sortBy} dir={sortDir} onClick={toggleSort} />
                </div>
                <div className="cell r">
                  <SortHeader label="Rec Yd" sortKey="recYd" active={sortBy} dir={sortDir} onClick={toggleSort} />
                </div>
                <div className="cell r">
                  <SortHeader label="Pass Yd" sortKey="passYd" active={sortBy} dir={sortDir} onClick={toggleSort} />
                </div>
                <div className="cell r">
                  <SortHeader label="TD" sortKey="td" active={sortBy} dir={sortDir} onClick={toggleSort} />
                </div>
                <div className="cell r">
                  <SortHeader label="Szn Pts" sortKey="proj" active={sortBy} dir={sortDir} onClick={toggleSort} />
                </div>
              </>
            )}
          </div>
          {list.length === 0 && <p className="hint" style={{ padding: "12px 4px" }}>No players match.</p>}
          {list.map((p, i) => {
            const stat = live[p.name];
            const seasonStat = seasonLive[p.name];
            const projValue = projMode === "season" ? seasonStat?.pts ?? null : stat?.proj ?? null;
            const tdTotal = seasonStat ? seasonStat.passTd + seasonStat.rushTd + seasonStat.recTd : null;
            return (
              <div
                className={`row rk ${projMode === "season" ? "rk-season" : ""} rowclick ${selected === p.name ? "on" : ""}`}
                key={p.name}
                onClick={() => setSelected(selected === p.name ? null : p.name)}
                style={{ borderLeftColor: TIER_COLOR[p.tier - 1] || "var(--oth)" }}
                title={`Tier ${p.tier}`}
              >
                <div className={`cell rank ${i < 3 ? "top" : ""}`}>{i + 1}</div>
                <div className="cell team">
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
                {projMode === "week" ? (
                  <>
                    <div className="cell r num" style={{ color: "var(--bone)" }}>
                      {stat?.adp != null ? stat.adp : "—"}
                    </div>
                    <div className="cell r num val">
                      {projValue != null ? projValue.toFixed(1) : "—"}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="cell r num" style={{ color: "var(--bone)" }}>
                      {seasonStat ? Math.round(seasonStat.rushYd) : "—"}
                    </div>
                    <div className="cell r num" style={{ color: "var(--bone)" }}>
                      {seasonStat ? Math.round(seasonStat.recYd) : "—"}
                    </div>
                    <div className="cell r num" style={{ color: "var(--bone)" }}>
                      {seasonStat ? Math.round(seasonStat.passYd) : "—"}
                    </div>
                    <div className="cell r num" style={{ color: "var(--bone)" }}>
                      {tdTotal != null ? Math.round(tdTotal) : "—"}
                    </div>
                    <div className="cell r num val">
                      {projValue != null ? projValue.toFixed(1) : "—"}
                    </div>
                  </>
                )}
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
              <span className="plabel">{week != null ? `Week ${week} Proj` : "Proj"}</span>
              <span className="pval">{selectedStat?.proj != null ? selectedStat.proj.toFixed(1) : "—"}</span>
            </div>
            {selectedMvp && (
              <div className="prow">
                <span className="plabel">MVP Odds ({selectedMvp.sportsbook})</span>
                <span className="pval" style={{ color: "var(--amber)" }}>
                  {selectedMvp.american > 0 ? `+${selectedMvp.american}` : selectedMvp.american}
                  <span style={{ color: "var(--dim)", fontWeight: 500, marginLeft: 6 }}>
                    ({(selectedMvp.probability * 100).toFixed(1)}%)
                  </span>
                </span>
              </div>
            )}
            {selectedSeason && (
              <>
                <div className="prow">
                  <span className="plabel">Season Proj Pts</span>
                  <span className="pval">{selectedSeason.pts.toFixed(1)}</span>
                </div>
                <div className="prow">
                  <span className="plabel">Weeks w/ projection</span>
                  <span className="pval">{selectedSeason.weeksCounted}/18</span>
                </div>
              </>
            )}

            <div className="foot">
              Tier is Fantis&rsquo; own starter grouping. ADP and projected points are live
              from Sleeper&rsquo;s public API; MVP odds are live from SharpAPI. Not investment
              or betting advice.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
