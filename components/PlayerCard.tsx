"use client";

import { useEffect, useState, type CSSProperties } from "react";
import {
  getPlayerGameLog,
  getSeasonWeeklyStats,
  HISTORICAL_SEASONS,
  type WeeklyStatLine,
} from "@/lib/sleeper";
import { posChipStyle, POS_COLOR, TIER_COLOR, TIER_LABELS } from "@/lib/players";
import { posRankColor } from "@/lib/rankColor";
import { computeAdjustedPpg, computeReceptionPointShare, computeRedZoneUsage } from "@/lib/seasonProfile";
import { getPlayerNews, type NewsArticle } from "@/lib/espnNews";
import { getInjuryReports, type InjuryReport } from "@/lib/espnInjuries";
import { getSeasonSchedule } from "@/lib/espnGames";
import { getSeasonInjuryReportsByEspnId, type WeeklyInjuryStatus } from "@/lib/nflverseInjuries";
import { useProjections } from "@/lib/useProjections";
import { useFantasyCalcValues, fantasyCalcValue } from "@/lib/fantasyCalc";
import type { PlayerMapEntry } from "@/lib/types";

const CHART_SEASONS = HISTORICAL_SEASONS;
type Tab = "general" | "logs" | "career" | "news";

// Real "last updated" timestamp Sleeper attaches to its own player news feed
// (news_updated, ms epoch) — shown next to the outbound link so a user can
// tell how fresh the report is before clicking through.
function timeAgo(ms: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function newsDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function returnDate(iso: string): string {
  // ESPN sends this as a bare YYYY-MM-DD (no time/zone) — parse as local
  // calendar date, not UTC, so it doesn't shift a day depending on timezone.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Logs table heat-map cells — same three-tier mint/amber/red convention the
// weekly PPR chart already uses for "how good was this game", just applied
// per-column here instead of just to points. Bucketed against this player's
// own min/max for that stat across the displayed season (not a league-wide
// or invented threshold) so it's always self-consistent real data.
function statTone(value: number, seasonValues: number[], higherIsBetter = true): string | null {
  const vals = seasonValues.filter((v) => v != null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (max === min) return null;
  const pct = (value - min) / (max - min);
  const rank = higherIsBetter ? pct : 1 - pct;
  if (rank >= 0.66) return "var(--mint)";
  if (rank >= 0.33) return "var(--amber)";
  return "var(--red)";
}

// Fixed PPR-point thresholds (standard fantasy benchmarks), not
// self-relative like statTone above — a 9-point week reads as bad
// regardless of whether it's this player's best or worst game, so PPR
// points/the weekly chart use fixed bands instead of the min/max-of-season
// scaling every other column still uses.
function pprTone(pts: number | null): string | null {
  if (pts == null) return null;
  if (pts < 10) return "var(--red)";
  if (pts < 20) return "var(--amber)";
  return "var(--mint)";
}

function toneStyle(tone: string | null): CSSProperties {
  if (!tone) return {};
  // Colored text on a neutral cell, not a solid fill — a wall of saturated
  // background across 8+ columns × 18 rows fought with the numbers instead
  // of highlighting them. Bold colored digits on the normal row background
  // is the more legible convention for a dense heat-map table.
  return { color: tone, fontWeight: 800 };
}

// Position-specific columns shown after the shared WK/OPP/PTS/RANK/SNP%
// prefix in the Logs table — real Sleeper box-score fields only (Opponent
// comes from ESPN's schedule, see getSeasonSchedule). No routes-run/YPRR,
// that's tracking data no free source has.
const LOG_COLUMNS: Record<string, { key: keyof WeeklyStatLine; label: string; decimals?: number }[]> = {
  QB: [
    { key: "passAtt", label: "PA" },
    { key: "passYd", label: "PYD" },
    { key: "passTd", label: "PTD" },
    { key: "passInt", label: "INT" },
    { key: "passRzAtt", label: "RZ" },
    { key: "rushAtt", label: "RA" },
    { key: "rushYd", label: "RYD" },
    { key: "rushTd", label: "RTD" },
  ],
  RB: [
    { key: "rushAtt", label: "CAR" },
    { key: "rushYd", label: "YD" },
    { key: "rushSharePct", label: "CAR%", decimals: 1 },
    { key: "rushTd", label: "TD" },
  ],
  WR: [
    { key: "recTgt", label: "TGT" },
    { key: "rec", label: "REC" },
    { key: "recYd", label: "YD" },
    { key: "recTd", label: "TD" },
    { key: "recYpt", label: "YPT", decimals: 1 },
    { key: "targetSharePct", label: "TS%", decimals: 1 },
    { key: "recRzTgt", label: "RZ TGT" },
  ],
  TE: [
    { key: "recTgt", label: "TGT" },
    { key: "rec", label: "REC" },
    { key: "recYd", label: "YD" },
    { key: "recTd", label: "TD" },
    { key: "recYpt", label: "YPT", decimals: 1 },
    { key: "targetSharePct", label: "TS%", decimals: 1 },
    { key: "recRzTgt", label: "RZ TGT" },
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

  // Real this-week projected points, for the header's at-a-glance stat
  // badges — same live Sleeper projection feed every other projection-based
  // number in the app already uses, just surfaced here too.
  const { projections, week: projWeek } = useProjections();
  const weekProj = projections?.[id]?.pts_ppr ?? null;
  const fcValues = useFantasyCalcValues();
  const fcValue = fcValues ? fantasyCalcValue(fcValues, { name: entry.n, pos: entry.p }) : 0;

  // Real injury report — ESPN's injuries feed carries the actual RotoWire
  // status blurb + return-date estimate for currently-injured players (see
  // lib/espnInjuries.ts). Fetched on mount, not gated behind a tab click,
  // since it's small and day-cached — only actually used when this player
  // has an injury designation at all.
  const [injuryReport, setInjuryReport] = useState<InjuryReport | null>(null);

  useEffect(() => {
    if (!entry.inj || entry.espnId == null) return;
    let cancelled = false;
    getInjuryReports()
      .then((reports) => {
        if (!cancelled) setInjuryReport(reports[String(entry.espnId)] ?? null);
      })
      .catch(() => {
        if (!cancelled) setInjuryReport(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.espnId, entry.inj]);

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

  // Adjusted PPG + reception-point share — both derived from the same real
  // per-game log the Logs tab uses (see lib/seasonProfile.ts), fetched here
  // too so they're ready as soon as General renders instead of only after
  // a user clicks into Logs.
  const [profileLines, setProfileLines] = useState<WeeklyStatLine[] | null>(null);

  useEffect(() => {
    if (tab !== "general") return;
    let cancelled = false;
    const t = setTimeout(() => {
      getPlayerGameLog(id, chartSeason)
        .then((lines) => {
          if (!cancelled) setProfileLines(lines);
        })
        .catch(() => {
          if (!cancelled) setProfileLines(null);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, chartSeason, id]);

  const adjustedPpg = profileLines ? computeAdjustedPpg(profileLines) : null;
  const receptionShare = profileLines ? computeReceptionPointShare(profileLines) : null;
  const redZoneUsage = profileLines ? computeRedZoneUsage(profileLines, entry.p) : null;

  // Logs tab — real per-game table for one season, plus that season's real
  // schedule (see getSeasonSchedule) so bye weeks can be told apart from
  // weeks the team played but this player didn't suit up.
  const [logSeason, setLogSeason] = useState(CHART_SEASONS[0]);
  const [logLines, setLogLines] = useState<WeeklyStatLine[] | null>(null);
  const [logSchedule, setLogSchedule] = useState<Record<number, Record<string, string>> | null>(null);
  const [logInjuryWeeks, setLogInjuryWeeks] = useState<Record<number, WeeklyInjuryStatus> | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    if (tab !== "logs") return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLogsLoading(true);
      Promise.all([
        getPlayerGameLog(id, logSeason),
        getSeasonSchedule(logSeason),
        getSeasonInjuryReportsByEspnId(logSeason).catch(() => ({}) as Record<string, WeeklyInjuryStatus[]>),
      ])
        .then(([lines, schedule, injuryReports]) => {
          if (cancelled) return;
          setLogLines(lines);
          setLogSchedule(schedule);
          const perPlayer = entry.espnId != null ? injuryReports[String(entry.espnId)] : undefined;
          setLogInjuryWeeks(
            perPlayer ? Object.fromEntries(perPlayer.map((w) => [w.week, w])) : {}
          );
        })
        .catch(() => {
          if (!cancelled) {
            setLogLines(null);
            setLogSchedule(null);
            setLogInjuryWeeks(null);
          }
        })
        .finally(() => {
          if (!cancelled) setLogsLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, logSeason, id, entry.espnId]);

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

  // News tab — real ESPN articles matched to this player's ESPN athlete id
  // (see lib/espnNews.ts for how the match works and its coverage limits).
  const [newsArticles, setNewsArticles] = useState<NewsArticle[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(false);

  useEffect(() => {
    if (tab !== "news" || newsArticles || !entry.espnId) return;
    let cancelled = false;
    setNewsLoading(true);
    setNewsError(false);
    getPlayerNews(entry.espnId)
      .then((articles) => {
        if (!cancelled) setNewsArticles(articles);
      })
      .catch(() => {
        if (!cancelled) setNewsError(true);
      })
      .finally(() => {
        if (!cancelled) setNewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, entry.espnId]);

  const played = (weekly ?? []).filter((w): w is number => w != null);
  const maxPts = Math.max(1, ...played);
  const cols = LOG_COLUMNS[entry.p] ?? LOG_COLUMNS.WR;

  // Real bye weeks (team missing from that week's schedule entirely) are
  // dropped; weeks the team played but this player has no stat line
  // (DNP/inactive) still show a row with dashes, per design — a silent gap
  // in the WK column read as a bug, not "this guy's team had a bye".
  const logRows = (logLines ?? []).filter((l) => logSchedule?.[l.week]?.[entry.t]);
  const seasonValues = (key: keyof WeeklyStatLine) =>
    logRows.map((l) => l[key]).filter((v): v is number => v != null);
  const rankValues = seasonValues("posRank");
  const snapValues = seasonValues("snapPct");
  const colValues = Object.fromEntries(cols.map((c) => [c.key, seasonValues(c.key)]));

  // Restrained header (2026-08, v2 — pulled back after the gradient/candy-
  // badge version read as generic/AI-slop): a thin position-color accent
  // line replaces the gradient wash, the name goes back to a single flat
  // tone, and the top-right stats drop their solid fills for bordered,
  // unfilled boxes — color only where it's actually meaningful (rank,
  // week proj), matching the "analytics terminal" direction. No new font:
  // stayed on Inter with tabular-nums for the terminal numeral feel,
  // consistent with the earlier font decision for this redesign.
  const accent = POS_COLOR[entry.p] || POS_COLOR.DEF;

  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="x modalclose" onClick={onClose}>
          ✕
        </button>
        <div className="pcardhead" style={{ borderTop: `3px solid ${accent}` }}>
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
          <div className="pcardheadinfo">
            <h3>{entry.n}</h3>
            <div className="pcardmeta">
              <span className="pos" style={posChipStyle(entry.p)}>
                {entry.p}
                {posRank ?? ""}
              </span>
              <span>{entry.t || "Free agent"}</span>
              {entry.age != null && <span>{entry.age} yo</span>}
              {entry.exp != null && <span>{entry.exp === 0 ? "Rookie" : `${entry.exp} yrs exp`}</span>}
              {entry.inj && (
                <span style={{ color: "var(--red)" }}>
                  {entry.inj}
                  {entry.injBodyPart ? ` (${entry.injBodyPart})` : ""}
                </span>
              )}
              {entry.practiceStatus && (
                <span style={{ color: "var(--dim)" }}>Practice: {entry.practiceStatus}</span>
              )}
            </div>
            <a
              className="linklike pcardnews"
              href={`https://sleeper.com/nfl/players/${id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {entry.inj ? "Injury report & news on Sleeper" : "Player news on Sleeper"} ↗
              {entry.newsUpdated != null && (
                <span className="pcardnewstime"> · updated {timeAgo(entry.newsUpdated)}</span>
              )}
            </a>
          </div>

          <div className="pcardheadstats">
            <div className="statbadge terminal">
              <b>{entry.p} Rank</b>
              <span className="statbadgeval" style={{ color: accent }}>{posRank ?? "—"}</span>
            </div>
            <div className="statbadge terminal">
              <b>ADP</b>
              <span className="statbadgeval">{adp ?? "—"}</span>
            </div>
            <div
              className="statbadge terminal"
              title={projWeek ? `Live Sleeper projection for Week ${projWeek}` : undefined}
            >
              <b>Wk{projWeek ?? ""} Proj</b>
              <span className="statbadgeval" style={{ color: "var(--amber)" }}>
                {weekProj != null ? weekProj.toFixed(1) : "—"}
              </span>
            </div>
            <div className="statbadge terminal" title="Real, independent trade value from fantasycalc.com (redraft, 1QB, PPR)">
              <b>FC Value</b>
              <span className="statbadgeval">{fcValue > 0 ? Math.round(fcValue) : "—"}</span>
            </div>
          </div>
        </div>

        <div className="tabs" style={{ marginTop: 14, marginBottom: 4 }}>
          {(["general", "logs", "career", "news"] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
              {t === "general" ? "General" : t === "logs" ? "Logs" : t === "career" ? "Career" : "News"}
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
              <div title="Real, independent trade value from fantasycalc.com (redraft, 1QB, PPR) — a second opinion, not blended into Fantis' own Value above.">
                <span className="plabel">FC Value</span>
                <span className="pval">{fcValue > 0 ? Math.round(fcValue) : "—"}</span>
              </div>
              <div title={`Avg PPR pts/game in ${chartSeason} games at a normal snap share (excludes injury/bench-share dips) — see the General hint below.`}>
                <span className="plabel">Adj PPG &rsquo;{chartSeason.slice(2)}</span>
                <span className="pval">{adjustedPpg ? adjustedPpg.ppg.toFixed(1) : "—"}</span>
              </div>
              <div title={`Share of ${chartSeason} PPR points from catches, receiving yards & receiving TDs.`}>
                <span className="plabel">Rec % Pts</span>
                <span className="pval">{receptionShare ? `${receptionShare.pct.toFixed(0)}%` : "—"}</span>
              </div>
              <div title={`Real ${chartSeason} scoring-range opportunity per game — ${entry.p === "QB" ? "red zone pass attempts" : entry.p === "RB" ? "red zone rush attempts + red zone targets" : "red zone targets"}.`}>
                <span className="plabel">RZ Opp/Gm</span>
                <span className="pval">{redZoneUsage ? redZoneUsage.perGame.toFixed(1) : "—"}</span>
              </div>
            </div>

            {injuryReport && (injuryReport.longComment || injuryReport.shortComment) && (
              <div className="injreport">
                <div className="injreporthead">
                  <span style={{ color: "var(--red)" }}>{injuryReport.status}</span>
                  {injuryReport.type && (
                    <span>
                      {injuryReport.type}
                      {injuryReport.detail ? ` ${injuryReport.detail.toLowerCase()}` : ""}
                    </span>
                  )}
                  {injuryReport.returnDate && <span>Targeting {returnDate(injuryReport.returnDate)}</span>}
                </div>
                <p className="injreporttext">{injuryReport.longComment || injuryReport.shortComment}</p>
                {injuryReport.source && injuryReport.date && (
                  <span className="injreportsource">
                    via {injuryReport.source} · {newsDate(injuryReport.date)}
                  </span>
                )}
              </div>
            )}

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
                    const barColor = pprTone(pts) ?? "var(--line)";
                    return (
                      <div
                        className="wbar"
                        key={i}
                        title={pts != null ? `Week ${i + 1}: ${pts.toFixed(1)} pts` : `Week ${i + 1}: did not play`}
                      >
                        <div className="wbarchart">
                          {pts != null && <span className="wbarval">{pts.toFixed(1)}</span>}
                          <div
                            className="wbarfill"
                            style={{
                              height: `${pct}%`,
                              background: pts == null ? barColor : `color-mix(in srgb, ${barColor} 55%, var(--ink))`,
                              borderTop: pts == null ? undefined : `2px solid ${barColor}`,
                            }}
                          />
                        </div>
                        <span className="wbarwk">{i + 1}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="hint" style={{ marginTop: 8 }}>
                Real per-week PPR results from Sleeper&rsquo;s public stats, not projections.
                Adj PPG averages only the {chartSeason} games where this player&rsquo;s snap
                share was at least half their own season median (real box-score data, not
                a hand-picked exclusion) &mdash; shown as &ldquo;&mdash;&rdquo; without at least 3 such
                games. Rec % Pts is the share of {chartSeason} points from catches,
                receiving yards &amp; receiving TDs. RZ Opp/Gm is real red-zone
                opportunity per game (scoring-range volume, not yardage) &mdash; pass
                attempts inside the 20 for QBs, rush attempts + red-zone targets for
                RBs, red-zone targets for WR/TE. FC Value is a real, independent number
                from fantasycalc.com (redraft, 1QB, PPR) &mdash; a second opinion, not
                blended into Fantis&rsquo; own Value. Not investment or betting advice.
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
              <div className="logtable logtable-games">
                <table>
                  <thead>
                    <tr>
                      <th>WK</th>
                      <th>OPP</th>
                      <th>PPR</th>
                      <th>RANK</th>
                      <th>SNP%</th>
                      {cols.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logRows.map((l) => {
                      const opp = logSchedule?.[l.week]?.[entry.t];
                      const ptsTone = pprTone(l.pts);
                      const rankTone = l.posRank != null ? statTone(l.posRank, rankValues, false) : null;
                      const snapTone = l.snapPct != null ? statTone(l.snapPct, snapValues) : null;
                      const injuryWeek = logInjuryWeeks?.[l.week];
                      return (
                        <tr key={l.week}>
                          <td>
                            {l.week}
                            {injuryWeek && (
                              <span
                                className="wkinjdot"
                                title={`${injuryWeek.status}${injuryWeek.bodyPart ? ` (${injuryWeek.bodyPart})` : ""} — official NFL injury report`}
                              />
                            )}
                          </td>
                          <td>{opp ? `@${opp}` : "—"}</td>
                          <td className="num" style={toneStyle(ptsTone)}>
                            {l.pts != null ? l.pts.toFixed(1) : "—"}
                          </td>
                          <td className="num" style={toneStyle(rankTone)}>
                            {l.posRank ?? "—"}
                          </td>
                          <td className="num" style={toneStyle(snapTone)}>
                            {l.snapPct != null ? l.snapPct.toFixed(0) : "—"}
                          </td>
                          {cols.map((c) => {
                            const v = l[c.key] as number | null;
                            const tone = v != null ? statTone(v, colValues[c.key]) : null;
                            return (
                              <td className="num" key={c.key} style={toneStyle(tone)}>
                                {v == null ? "—" : c.decimals ? v.toFixed(c.decimals) : v}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                    {logRows.length === 0 && (
                      <tr>
                        <td colSpan={5 + cols.length} className="trempty">
                          No games that season.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <p className="hint" style={{ marginTop: 8 }}>
              Real box-score stats from Sleeper; opponent and bye weeks from
              ESPN&rsquo;s real schedule (bye weeks are left out entirely, not
              shown as a blank row). Cell color shows how that game compares
              to this player&rsquo;s own {logSeason} range for that stat &mdash; real,
              self-relative, not a league benchmark. Carry% and target-share
              are each stat&rsquo;s share of the current roster&rsquo;s total that
              week — real, but based on today&rsquo;s team, not necessarily who
              they played with that season if since traded. A red dot on the
              week number means this player was on the official NFL injury
              report that week (nflverse data), even in games he played.
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

        {tab === "news" && (
          <div className="pcardchart">
            <div className="sechead" style={{ marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Player news</span>
            </div>
            {!entry.espnId ? (
              <p className="hint">
                No ESPN match for this player &mdash; see the Sleeper link above for real updates.
              </p>
            ) : newsLoading ? (
              <p className="hint">Loading real ESPN news…</p>
            ) : newsError ? (
              <p className="hint">Couldn&rsquo;t reach ESPN news.</p>
            ) : newsArticles && newsArticles.length > 0 ? (
              <div className="newslist">
                {newsArticles.map((a) => (
                  <a className="newsitem" key={a.id} href={a.link} target="_blank" rel="noopener noreferrer">
                    {a.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="newsthumb" src={a.imageUrl} alt="" />
                    )}
                    <div className="newsbody">
                      <span className="newsheadline">
                        {a.isVideo ? "▶ " : ""}
                        {a.headline}
                      </span>
                      {a.description && <span className="newsdesc">{a.description}</span>}
                      <span className="newsdate">{newsDate(a.published)} · espn.com</span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="hint">
                No recent ESPN headlines for {entry.n}. ESPN&rsquo;s feed only carries
                published articles (trades, milestones, storylines) &mdash; for routine
                injury/practice updates, see the Sleeper link above.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
