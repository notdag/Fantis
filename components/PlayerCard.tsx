"use client";

import { useEffect, useState } from "react";
import {
  getPlayerGameLog,
  getSeasonWeeklyStats,
  HISTORICAL_SEASONS,
  type WeeklyStatLine,
} from "@/lib/sleeper";
import { posChipStyle, TIER_COLOR, TIER_LABELS } from "@/lib/players";
import { posRankColor } from "@/lib/rankColor";
import type { PlayerMapEntry } from "@/lib/types";

const CHART_SEASONS = HISTORICAL_SEASONS;
type Tab = "general" | "logs" | "career";

// Which columns to show in the Logs table, per position — real Sleeper
// fields only. No Opponent column (Sleeper has no public schedule
// endpoint) and no routes-run/YPRR (that's tracking data no free source has).
const LOG_COLUMNS: Record<string, { key: keyof WeeklyStatLine; label: string; decimals?: number }[]> = {
  QB: [
    { key: "passAtt", label: "PA" },
    { key: "passYd", label: "PYD" },
    { key: "passTd", label: "PTD" },
    { key: "passInt", label: "INT" },
    { key: "rushAtt", label: "RA" },
    { key: "rushYd", label: "RYD" },
    { key: "rushTd", label: "RTD" },
  ],
  RB: [
    { key: "rushAtt", label: "RA" },
    { key: "rushYd", label: "RYD" },
    { key: "rushTd", label: "RTD" },
    { key: "recTgt", label: "TGT" },
    { key: "rec", label: "REC" },
    { key: "recYd", label: "RYD" },
    { key: "recTd", label: "RTD" },
  ],
  WR: [
    { key: "recTgt", label: "TGT" },
    { key: "rec", label: "REC" },
    { key: "recYd", label: "YD" },
    { key: "recTd", label: "TD" },
    { key: "recYpt", label: "YPT", decimals: 1 },
    { key: "targetSharePct", label: "TS%", decimals: 1 },
  ],
  TE: [
    { key: "recTgt", label: "TGT" },
    { key: "rec", label: "REC" },
    { key: "recYd", label: "YD" },
    { key: "recTd", label: "TD" },
    { key: "recYpt", label: "YPT", decimals: 1 },
    { key: "targetSharePct", label: "TS%", decimals: 1 },
  ],
};

export default function PlayerCard({
  id,
  entry,
  adp,
  posRank,
  tier,
  value,
  poolSize,
  onClose,
}: {
  id: string;
  entry: PlayerMapEntry;
  adp: number | null;
  posRank: number | null;
  tier: number | null;
  value: number | null;
  poolSize: number;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [imgOk, setImgOk] = useState(true);

  // General tab — weekly PPR chart
  const [chartSeason, setChartSeason] = useState(CHART_SEASONS[0]);
  const [weekly, setWeekly] = useState<(number | null)[] | null>(null);
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    if (tab !== "general") return;
    let cancelled = false;
    const t = setTimeout(() => {
      setChartLoading(true);
      getSeasonWeeklyStats(chartSeason)
        .then((all) => {
          if (!cancelled) setWeekly(all[id] ?? null);
        })
        .catch(() => {
          if (!cancelled) setWeekly(null);
        })
        .finally(() => {
          if (!cancelled) setChartLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, chartSeason, id]);

  // Logs tab — real per-game table for one season
  const [logSeason, setLogSeason] = useState(CHART_SEASONS[0]);
  const [logLines, setLogLines] = useState<WeeklyStatLine[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    if (tab !== "logs") return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLogsLoading(true);
      getPlayerGameLog(id, logSeason)
        .then((lines) => {
          if (!cancelled) setLogLines(lines);
        })
        .catch(() => {
          if (!cancelled) setLogLines(null);
        })
        .finally(() => {
          if (!cancelled) setLogsLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, logSeason, id]);

  // Career tab — real multi-season averages, built from the same per-game log
  interface CareerRow {
    season: string;
    gp: number;
    ptsTotal: number;
    ptsAvg: number;
    rankAvg: number | null;
  }
  const [careerRows, setCareerRows] = useState<CareerRow[] | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);

  useEffect(() => {
    if (tab !== "career" || careerRows) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setCareerLoading(true);
      Promise.all(CHART_SEASONS.map((s) => getPlayerGameLog(id, s)))
        .then((results) => {
          if (cancelled) return;
          const rows: CareerRow[] = CHART_SEASONS.map((season, i) => {
            const played = results[i].filter((l) => l.pts != null);
            const ptsTotal = played.reduce((sum, l) => sum + (l.pts ?? 0), 0);
            const ranks = played.map((l) => l.posRank).filter((r): r is number => r != null);
            return {
              season,
              gp: played.length,
              ptsTotal,
              ptsAvg: played.length > 0 ? ptsTotal / played.length : 0,
              rankAvg: ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null,
            };
          }).filter((r) => r.gp > 0);
          setCareerRows(rows);
        })
        .catch(() => {
          if (!cancelled) setCareerRows([]);
        })
        .finally(() => {
          if (!cancelled) setCareerLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, id]);

  const played = (weekly ?? []).filter((w): w is number => w != null);
  const maxPts = Math.max(1, ...played);
  const cols = LOG_COLUMNS[entry.p] ?? LOG_COLUMNS.WR;

  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="x modalclose" onClick={onClose}>
          ✕
        </button>
        <div className="pcardhead">
          {imgOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="pcardphoto"
              src={`https://sleepercdn.com/content/nfl/players/${id}.jpg`}
              alt=""
              onError={() => setImgOk(false)}
            />
          ) : (
            <div className="pcardphoto" />
          )}
          <div>
            <h3>{entry.n}</h3>
            <div className="pcardmeta">
              <span className="pos" style={posChipStyle(entry.p)}>
                {entry.p}
                {posRank ?? ""}
              </span>
              <span>{entry.t || "Free agent"}</span>
              {entry.age != null && <span>{entry.age} yo</span>}
              {entry.exp != null && <span>{entry.exp === 0 ? "Rookie" : `${entry.exp} yrs exp`}</span>}
              {entry.inj && <span style={{ color: "var(--red)" }}>{entry.inj}</span>}
            </div>
          </div>
        </div>

        <div className="tabs" style={{ marginTop: 14, marginBottom: 4 }}>
          {(["general", "logs", "career"] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
              {t === "general" ? "General" : t === "logs" ? "Logs" : "Career"}
            </button>
          ))}
        </div>

        {tab === "general" && (
          <>
            <div className="pcardstats">
              <div>
                <span className="plabel">Tier</span>
                <span className="pval" style={{ color: tier ? TIER_COLOR[tier - 1] : "var(--dim)" }}>
                  {tier ? TIER_LABELS[tier - 1] : "—"}
                </span>
              </div>
              <div>
                <span className="plabel">ADP</span>
                <span className="pval" style={{ color: "var(--dim)" }}>
                  {adp ?? "—"}
                </span>
              </div>
              <div>
                <span className="plabel">Pos Rank</span>
                <span className="pval" style={{ color: posRankColor(posRank, poolSize) }}>
                  {posRank ?? "—"}
                </span>
              </div>
              <div>
                <span className="plabel">Value</span>
                <span className="pval" style={{ color: "var(--amber)" }}>
                  {value != null ? value.toFixed(1) : "—"}
                </span>
              </div>
            </div>

            <div className="pcardchart">
              <div className="sechead" style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Weekly PPR points</span>
                <select
                  className="select sm"
                  value={chartSeason}
                  onChange={(e) => setChartSeason(e.target.value)}
                >
                  {CHART_SEASONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              {chartLoading ? (
                <p className="hint">Loading real weekly results…</p>
              ) : played.length === 0 ? (
                <p className="hint">No games played that season.</p>
              ) : (
                <div className="wchart">
                  {(weekly ?? []).map((pts, i) => {
                    const pct = pts != null ? Math.max(4, (pts / maxPts) * 100) : 0;
                    const barColor =
                      pts == null
                        ? "var(--line)"
                        : pts >= maxPts * 0.66
                          ? "var(--mint)"
                          : pts >= maxPts * 0.33
                            ? "var(--amber)"
                            : "var(--red)";
                    return (
                      <div
                        className="wbar"
                        key={i}
                        title={pts != null ? `Week ${i + 1}: ${pts.toFixed(1)} pts` : `Week ${i + 1}: did not play`}
                      >
                        <div className="wbarchart">
                          {pts != null && <span className="wbarval">{pts.toFixed(1)}</span>}
                          <div className="wbarfill" style={{ height: `${pct}%`, background: barColor }} />
                        </div>
                        <span className="wbarwk">{i + 1}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="hint" style={{ marginTop: 8 }}>
                Real per-week PPR results from Sleeper&rsquo;s public stats, not projections.
                Not investment or betting advice.
              </p>
            </div>
          </>
        )}

        {tab === "logs" && (
          <div className="pcardchart">
            <div className="sechead" style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Game log</span>
              <select className="select sm" value={logSeason} onChange={(e) => setLogSeason(e.target.value)}>
                {CHART_SEASONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            {logsLoading ? (
              <p className="hint">Loading real game log…</p>
            ) : (
              <div className="logtable">
                <table>
                  <thead>
                    <tr>
                      <th>WK</th>
                      <th>PTS</th>
                      <th>RK</th>
                      <th>SNP%</th>
                      {cols.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(logLines ?? [])
                      .filter((l) => l.pts != null)
                      .map((l) => (
                        <tr key={l.week}>
                          <td>{l.week}</td>
                          <td className="num">{l.pts?.toFixed(1)}</td>
                          <td className="num">{l.posRank ?? "—"}</td>
                          <td className="num">{l.snapPct != null ? l.snapPct.toFixed(0) : "—"}</td>
                          {cols.map((c) => {
                            const v = l[c.key];
                            return (
                              <td className="num" key={c.key}>
                                {v == null ? "—" : c.decimals ? (v as number).toFixed(c.decimals) : v}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    {(logLines ?? []).every((l) => l.pts == null) && (
                      <tr>
                        <td colSpan={4 + cols.length} className="trempty">
                          No games played that season.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <p className="hint" style={{ marginTop: 8 }}>
              Real box-score stats from Sleeper. Target share (TS%) is that
              week&rsquo;s targets divided by the current roster&rsquo;s pass-catchers&rsquo;
              combined targets — real, but based on today&rsquo;s team, not
              necessarily who they played with that season if since traded.
            </p>
          </div>
        )}

        {tab === "career" && (
          <div className="pcardchart">
            <div className="sechead" style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Career (by season)</span>
            </div>
            {careerLoading ? (
              <p className="hint">Loading real season-by-season history…</p>
            ) : (
              <div className="logtable">
                <table>
                  <thead>
                    <tr>
                      <th>Season</th>
                      <th>GP</th>
                      <th>PPR Total</th>
                      <th>PPR Avg</th>
                      <th>Rank Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(careerRows ?? []).map((r) => (
                      <tr key={r.season}>
                        <td>{r.season}</td>
                        <td className="num">{r.gp}</td>
                        <td className="num">{r.ptsTotal.toFixed(1)}</td>
                        <td className="num">{r.ptsAvg.toFixed(1)}</td>
                        <td className="num">{r.rankAvg != null ? r.rankAvg.toFixed(1) : "—"}</td>
                      </tr>
                    ))}
                    {careerRows && careerRows.length === 0 && (
                      <tr>
                        <td colSpan={5} className="trempty">
                          No prior seasons with games played.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <p className="hint" style={{ marginTop: 8 }}>
              Real per-season averages from Sleeper&rsquo;s actual box scores across{" "}
              {CHART_SEASONS[CHART_SEASONS.length - 1]}&ndash;{CHART_SEASONS[0]}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
