"use client";

import { useEffect, useState } from "react";
import { getSeasonWeeklyStats, SEASONS } from "@/lib/sleeper";
import { posChipStyle, TIER_COLOR, TIER_LABELS } from "@/lib/players";
import { adpColor, posRankColor } from "@/lib/rankColor";
import type { PlayerMapEntry } from "@/lib/types";

// Only fully-completed seasons make sense for a real weekly-results chart —
// SEASONS' first entry is the live/current season, which won't have a full
// 18 weeks of actual box scores yet.
const CHART_SEASONS = SEASONS.slice(1);

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
  const [season, setSeason] = useState(CHART_SEASONS[0]);
  const [weekly, setWeekly] = useState<(number | null)[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [imgOk, setImgOk] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const id0 = setTimeout(() => {
      setLoading(true);
      getSeasonWeeklyStats(season)
        .then((all) => {
          if (!cancelled) setWeekly(all[id] ?? null);
        })
        .catch(() => {
          if (!cancelled) setWeekly(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id0);
    };
  }, [season, id]);

  const played = (weekly ?? []).filter((w): w is number => w != null);
  const maxPts = Math.max(1, ...played);

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
              {entry.inj && (
                <span style={{ color: "var(--red)" }}>{entry.inj}</span>
              )}
            </div>
          </div>
        </div>

        <div className="pcardstats">
          <div>
            <span className="plabel">Tier</span>
            <span className="pval" style={{ color: tier ? TIER_COLOR[tier - 1] : "var(--dim)" }}>
              {tier ? TIER_LABELS[tier - 1] : "—"}
            </span>
          </div>
          <div>
            <span className="plabel">ADP</span>
            <span className="pval" style={{ color: adpColor(adp) }}>
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
              value={season}
              onChange={(e) => setSeason(e.target.value)}
            >
              {CHART_SEASONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {loading ? (
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
                  <div className="wbar" key={i} title={pts != null ? `Week ${i + 1}: ${pts.toFixed(1)} pts` : `Week ${i + 1}: did not play`}>
                    <div className="wbarfill" style={{ height: `${pct}%`, background: barColor }} />
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
      </div>
    </div>
  );
}
