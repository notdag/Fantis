"use client";

import { useMemo, useState } from "react";
import { posChipStyle } from "@/lib/players";
import { usePortfolio } from "@/lib/usePortfolio";
import SortHeader from "@/components/SortHeader";
import PixelLoader from "@/components/PixelLoader";
import type { SleeperLeague } from "@/lib/types";

type ExposureSortKey = "name" | "pos" | "value" | "portfolioValue" | "exposure" | "injured";
type SortDir = "asc" | "desc";

const EXPOSURE_DEFAULT_DIR: Record<ExposureSortKey, SortDir> = {
  name: "asc",
  pos: "asc",
  value: "desc",
  portfolioValue: "desc",
  exposure: "desc",
  injured: "desc",
};

const LEAGUES_PREVIEW_COUNT = 15;

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const POS_LABEL: Record<(typeof POSITIONS)[number], string> = {
  QB: "QBs",
  RB: "RBs",
  WR: "WRs",
  TE: "TEs",
};

// "Patrick Mahomes" -> "P. Mahomes" — fits inside a small bubble caption.
function abbrevName(name: string): string {
  const parts = name.split(" ");
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

// Cross-league portfolio view — see lib/usePortfolio.ts for the real data
// behind each section (all of it from leagues you're already synced to,
// nothing new fetched beyond real Sleeper rosters).
export default function Portfolio({
  leagues,
  myUserId,
  onGoToLeagues,
  onOpenLeague,
}: {
  leagues: SleeperLeague[];
  myUserId: string | null;
  onGoToLeagues: () => void;
  onOpenLeague: (lg: SleeperLeague) => void;
}) {
  const {
    overview,
    exposure,
    recordSnapshot,
    positionalDepth,
    receivedTrades,
    loading,
    error,
    leaguesLoaded,
    leaguesTotal,
  } = usePortfolio(leagues, myUserId);
  const [showAllLeagues, setShowAllLeagues] = useState(false);
  const [exposureView, setExposureView] = useState<"map" | "table">("map");
  const [posFilter, setPosFilter] = useState<"ALL" | (typeof POSITIONS)[number]>("ALL");
  const [injuredOnly, setInjuredOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expSortBy, setExpSortBy] = useState<ExposureSortKey>("exposure");
  const [expSortDir, setExpSortDir] = useState<SortDir>("desc");

  const toggleExpSort = (key: ExposureSortKey) => {
    if (expSortBy === key) {
      setExpSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setExpSortBy(key);
      setExpSortDir(EXPOSURE_DEFAULT_DIR[key]);
    }
  };

  const filteredExposure = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return exposure.filter(
      (r) =>
        (posFilter === "ALL" || r.pos === posFilter) &&
        (!injuredOnly || !!r.inj) &&
        (!q || r.name.toLowerCase().includes(q))
    );
  }, [exposure, posFilter, injuredOnly, searchQuery]);

  const sortedExposure = useMemo(() => {
    const dir = expSortDir === "asc" ? 1 : -1;
    const rows = [...filteredExposure];
    rows.sort((a, b) => {
      switch (expSortBy) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "pos":
          return (a.pos.localeCompare(b.pos) || a.name.localeCompare(b.name)) * dir;
        case "value":
          return (a.value - b.value) * dir;
        case "portfolioValue":
          return (a.value * a.count - b.value * b.count) * dir;
        case "exposure": {
          const ae = a.totalLeagues > 0 ? a.count / a.totalLeagues : 0;
          const be = b.totalLeagues > 0 ? b.count / b.totalLeagues : 0;
          return (ae - be) * dir;
        }
        case "injured": {
          // Injured players first (or last, toggled); within that, real
          // status text alphabetically so same-status players group.
          const ai = a.inj ? 1 : 0;
          const bi = b.inj ? 1 : 0;
          if (ai !== bi) return (ai - bi) * dir;
          return (a.inj ?? "").localeCompare(b.inj ?? "") * dir;
        }
        default:
          return 0;
      }
    });
    return rows;
  }, [filteredExposure, expSortBy, expSortDir]);

  if (leagues.length === 0) {
    return (
      <section className="sec">
        <h2>Portfolio</h2>
        <p className="sub">
          Sync your Sleeper username first to see a combined view across every league you&rsquo;re in.
        </p>
        <button className="btn" onClick={onGoToLeagues}>
          Go to Leagues →
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="sec">
        <div className="sechead">
          <h2>Portfolio</h2>
          <span className="rt">{leagues.length} leagues synced</span>
        </div>
        {loading && (
          <p className="hint">
            <PixelLoader
              label={`Loading rosters across your leagues… (${leaguesLoaded}/${leaguesTotal})`}
              showElapsed
            />
          </p>
        )}
        {error && <p className="hint">{error}</p>}

        <div className="portsummary">
          <div className="portcard">
            <div className="portcardhead">Record snapshot</div>
            <p className="portcardtitle">
              {recordSnapshot.winning > recordSnapshot.losing
                ? "More winning than losing."
                : recordSnapshot.losing > recordSnapshot.winning
                  ? "More losing than winning."
                  : "Evenly split between winning and losing."}
            </p>
            <div className="portcardrows">
              <div className="portcardrow">
                <span>Winning record</span>
                <b>{recordSnapshot.winning}</b>
              </div>
              <div className="portcardrow">
                <span>.500 teams</span>
                <b>{recordSnapshot.even}</b>
              </div>
              <div className="portcardrow">
                <span>Losing record</span>
                <b>{recordSnapshot.losing}</b>
              </div>
            </div>
          </div>

          <div className="portcard">
            <div className="portcardhead">Positional depth</div>
            <p className="portcardtitle">
              Relative to your own roster — not a league-wide comparison.
            </p>
            <div className="portcardrows">
              {positionalDepth.map((d) => (
                <div className="portcardrow" key={d.pos}>
                  <span>{d.pos}</span>
                  <b>{d.tier}</b>
                </div>
              ))}
              {positionalDepth.length === 0 && <span className="hint">No roster data yet.</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="sechead">
          <h2 style={{ fontSize: 18 }}>Trade inbox</h2>
          <span className="rt">
            {receivedTrades.length > 0
              ? `${receivedTrades.length} received this season`
              : "Real offers you've received"}
          </span>
        </div>
        {receivedTrades.length > 0 ? (
          <div className="tradeinbox">
            {receivedTrades.map((t) => (
              <button
                key={t.transactionId}
                className="tradeinboxrow"
                onClick={() => onOpenLeague(leagues.find((l) => l.league_id === t.leagueId)!)}
              >
                <span className="tname">{t.leagueName}</span>
                <span className={`tradeinboxstatus ${t.status === "pending" && t.waitingOnMe ? "on-you" : ""}`}>
                  {t.status === "pending"
                    ? t.waitingOnMe
                      ? "Waiting on you"
                      : "Waiting on them"
                    : t.status === "complete"
                      ? "Accepted"
                      : "Declined"}
                </span>
                <span className="tradeinboxswap">
                  <span className="get">+{t.myGets.join(", ") || "—"}</span>
                  <span className="give">−{t.myGives.join(", ") || "—"}</span>
                </span>
                <span className="portmeta">from {t.otherTeamName}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="hint">
            No trade offers from other teams found yet this season, across any synced league.
          </p>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          Every real trade another manager has sent you this season, from Sleeper&rsquo;s own
          transaction log — accepted, declined, and still-pending offers alike. Doesn&rsquo;t
          include trades you proposed yourself. Informational only — Fantis can&rsquo;t accept or
          decline on your behalf (read-only, no account access); open the league to respond in
          Sleeper.
        </p>
      </section>

      <section className="sec">
        <div className="sechead">
          <h2 style={{ fontSize: 18 }}>League overview</h2>
          <span className="rt">Sorted by real roster value</span>
        </div>
        <div className="portoverview">
          {(showAllLeagues ? overview : overview.slice(0, LEAGUES_PREVIEW_COUNT)).map(
            ({ lg, myRoster, value, powerRank, powerTotal, fcPowerRank }) => (
            <button
              className="portoverviewrow"
              key={lg.league_id}
              onClick={() => onOpenLeague(lg)}
            >
              <span className="tname">{lg.name}</span>
              <span className="portmeta">{lg.total_rosters} teams</span>
              {myRoster && (
                <span className="portmeta">
                  {myRoster.settings?.wins ?? 0}-{myRoster.settings?.losses ?? 0}
                  {myRoster.settings?.ties ? `-${myRoster.settings.ties}` : ""}
                </span>
              )}
              {powerRank != null && (
                <span className="portmeta">
                  #{powerRank} of {powerTotal}
                </span>
              )}
              {fcPowerRank != null && (
                <span className="portmeta portmeta-fc" title="Power rank by FantasyCalc's own player values, via fantasycalc.com">
                  FC #{fcPowerRank} of {powerTotal}
                </span>
              )}
              {myRoster?.settings?.fpts != null && (
                <span className="portmeta">
                  {(myRoster.settings.fpts + (myRoster.settings.fpts_decimal ?? 0) / 100).toFixed(1)} PF
                </span>
              )}
              <span className="portvalue">{Math.round(value)}</span>
            </button>
          ))}
          {overview.length === 0 && !loading && <p className="hint">No roster data yet.</p>}
        </div>
        {overview.length > LEAGUES_PREVIEW_COUNT && (
          <button
            className="chip-filter"
            style={{ marginTop: 10 }}
            onClick={() => setShowAllLeagues((v) => !v)}
          >
            {showAllLeagues
              ? "Show fewer"
              : `Show all ${overview.length} leagues`}
          </button>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          Power rank compares your real roster trade value against every other team&rsquo;s in that
          same league — same methodology the Trade calculator uses, just ranked per league instead
          of shown as one number. FC rank is the same comparison using{" "}
          <a href="https://www.fantasycalc.com" target="_blank" rel="noreferrer">
            FantasyCalc&rsquo;s
          </a>{" "}
          own published player values instead of Fantis&rsquo;s — a second, independently-sourced
          opinion, not blended into the first. Not investment or betting advice.
        </p>
      </section>

      <section className="sec">
        <div className="sechead">
          <h2 style={{ fontSize: 18 }}>Player exposure</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={`chip-filter ${exposureView === "map" ? "on" : ""}`}
              onClick={() => setExposureView("map")}
            >
              Map
            </button>
            <button
              className={`chip-filter ${exposureView === "table" ? "on" : ""}`}
              onClick={() => setExposureView("table")}
            >
              Table
            </button>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
          <input
            className="input"
            placeholder="Search players…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <button
            className={`chip-filter ${posFilter === "ALL" ? "on" : ""}`}
            onClick={() => setPosFilter("ALL")}
          >
            All
          </button>
          {POSITIONS.map((p) => (
            <button
              key={p}
              className={`chip-filter ${posFilter === p ? "on" : ""}`}
              onClick={() => setPosFilter(p)}
            >
              {p}
            </button>
          ))}
          <button
            className={`chip-filter ${injuredOnly ? "on" : ""}`}
            onClick={() => setInjuredOnly((v) => !v)}
            style={{ marginLeft: 8 }}
          >
            Injured only
          </button>
        </div>

        {exposureView === "map" ? (
          <div className="exposuregroups">
            {POSITIONS.map((pos) => {
              if (posFilter !== "ALL" && posFilter !== pos) return null;
              const rows = filteredExposure.filter((r) => r.pos === pos);
              if (rows.length === 0) return null;
              // Bubble diameter scales with real exposure count, relative to
              // this position's own max — real magnitude, not a fixed grid.
              const maxCount = Math.max(...rows.map((r) => r.count));
              const minSize = 44;
              const maxSize = 82;
              return (
                <div className="exposuregroup" key={pos}>
                  <div className="exposuregrouphead">
                    <span className="tier" style={{ background: `var(--${pos.toLowerCase()})` }} />
                    {POS_LABEL[pos]}
                    <span className="rt">{rows.length}</span>
                  </div>
                  <div className="exposuregrid">
                    {rows.map((r, idx) => {
                      const size =
                        maxCount > 1
                          ? Math.round(minSize + (r.count / maxCount) * (maxSize - minSize))
                          : minSize;
                      const statusClass = !r.inj
                        ? ""
                        : /out|doubtful|ir/i.test(r.inj)
                          ? "out"
                          : "ques";
                      return (
                        <div
                          className={`expbubble ${idx < 2 ? "featured" : ""}`}
                          key={r.playerId}
                          style={{ width: size, height: size }}
                          title={`${r.name} — rostered in ${r.count} of your leagues${r.inj ? ` · ${r.inj}` : ""}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            className="expbubblephoto"
                            src={`https://sleepercdn.com/content/nfl/players/${r.playerId}.jpg`}
                            alt=""
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                            }}
                          />
                          {statusClass && <span className={`expbubblestatus ${statusClass}`} />}
                          <span className="expbubblecaption">
                            <span className="expbubblename">{abbrevName(r.name)}</span>
                            <span className="expbubblecount">{r.count}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {filteredExposure.length === 0 && !loading && (
              <p className="hint">
                {exposure.length === 0 ? "No rostered players found yet." : "No players match these filters."}
              </p>
            )}
          </div>
        ) : (
          <div className="logtable">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>
                    <SortHeader label="Player" sortKey="name" active={expSortBy} dir={expSortDir} onClick={toggleExpSort} />
                  </th>
                  <th>
                    <SortHeader label="Pos" sortKey="pos" active={expSortBy} dir={expSortDir} onClick={toggleExpSort} />
                  </th>
                  <th>
                    <SortHeader label="Injured" sortKey="injured" active={expSortBy} dir={expSortDir} onClick={toggleExpSort} />
                  </th>
                  <th>
                    <SortHeader label="Value" sortKey="value" active={expSortBy} dir={expSortDir} onClick={toggleExpSort} />
                  </th>
                  <th>
                    <SortHeader
                      label="Portfolio value"
                      sortKey="portfolioValue"
                      active={expSortBy}
                      dir={expSortDir}
                      onClick={toggleExpSort}
                    />
                  </th>
                  <th>
                    <SortHeader label="Exposure" sortKey="exposure" active={expSortBy} dir={expSortDir} onClick={toggleExpSort} />
                  </th>
                  <th>Leagues</th>
                </tr>
              </thead>
              <tbody>
                {sortedExposure.map((r) => (
                  <tr key={r.playerId}>
                    <td style={{ textAlign: "left" }}>{r.name}</td>
                    <td className="num">
                      <span className="pos" style={posChipStyle(r.pos)}>
                        {r.pos}
                      </span>
                    </td>
                    <td className="num" style={{ color: r.inj ? "var(--red)" : "var(--dim)" }}>
                      {r.inj ?? "—"}
                    </td>
                    <td className="num">{Math.round(r.value)}</td>
                    <td className="num">{Math.round(r.value * r.count)}</td>
                    <td className="num">
                      {r.totalLeagues > 0 ? `${Math.round((r.count / r.totalLeagues) * 100)}%` : "—"}
                    </td>
                    <td className="num">
                      {r.count}/{r.totalLeagues}
                    </td>
                  </tr>
                ))}
                {sortedExposure.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="trempty">
                      {exposure.length === 0
                        ? "No rostered players found yet."
                        : "No players match these filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>
          Value is this player&rsquo;s real curated trade value; portfolio value multiplies that by
          how many of your leagues roster him. Exposure is simply leagues owned ÷ leagues synced.
          Not investment or betting advice.
        </p>
      </section>
    </>
  );
}
