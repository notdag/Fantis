"use client";

import { useMemo, useState } from "react";
import { IconArrowUp, IconArrowDown, IconFlag, IconCheck, IconUsers } from "./MgrIcons";
import { PageHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";

export interface MatchupCenterRow {
  leagueId: string;
  leagueName: string;
  week: number;
  myPoints: number;
  myProjPoints: number | null;
  opponentTeamName: string | null;
  opponentPoints: number | null;
  opponentProjPoints: number | null;
}

type SortKey = "margin" | "name" | "myPoints" | "opponentPoints";

function Margin({ value }: { value: number | null }) {
  if (value == null) return <span className="portmeta">—</span>;
  const rounded = Math.round(value * 10) / 10;
  const color = rounded > 0 ? "var(--mint)" : rounded < 0 ? "var(--red)" : "var(--muted)";
  return (
    <span className="mgrdiff" style={{ color }}>
      {rounded !== 0 && (rounded > 0 ? <IconArrowUp /> : <IconArrowDown />)}
      {rounded > 0 ? "+" : ""}
      {rounded.toFixed(1)}
    </span>
  );
}

// Real, in-progress point totals, plus Sleeper's own real weekly
// projection shown as a muted secondary line — never a Fantis-computed
// win probability or prediction. "Leading"/"Trailing" describes the score
// as synced right now, not a forecast of the final result.
export default function MatchupCenter({ rows }: { rows: MatchupCenterRow[] }) {
  const [sortBy, setSortBy] = useState<SortKey>("margin");
  const [trailingOnly, setTrailingOnly] = useState(false);

  const withMargin = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        margin: r.opponentPoints != null ? r.myPoints - r.opponentPoints : null,
      })),
    [rows]
  );

  const summary = useMemo(() => {
    let leading = 0, trailing = 0, tied = 0, undecided = 0;
    for (const r of withMargin) {
      if (r.margin == null) undecided += 1;
      else if (r.margin > 0) leading += 1;
      else if (r.margin < 0) trailing += 1;
      else tied += 1;
    }
    return { leading, trailing, tied, undecided };
  }, [withMargin]);

  const filtered = useMemo(
    () => (trailingOnly ? withMargin.filter((r) => r.margin != null && r.margin < 0) : withMargin),
    [withMargin, trailingOnly]
  );

  const sorted = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.leagueName.localeCompare(b.leagueName);
        case "myPoints":
          return b.myPoints - a.myPoints;
        case "opponentPoints":
          return (b.opponentPoints ?? -1) - (a.opponentPoints ?? -1);
        case "margin":
        default:
          // Closest matchup first; matchups with no synced opponent yet
          // sort to the bottom rather than pretending a margin of 0.
          if (a.margin == null && b.margin == null) return 0;
          if (a.margin == null) return 1;
          if (b.margin == null) return -1;
          return Math.abs(a.margin) - Math.abs(b.margin);
      }
    });
    return rows;
  }, [filtered, sortBy]);

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          description={
            <>
              Every league&rsquo;s current matchup in one place, sorted closest-first by default —
              instead of clicking into each league to see how close it is. Scores are live,
              in-progress totals as of the last sync; the smaller proj line is Sleeper&rsquo;s own
              weekly projection, not a Fantis-computed prediction of who wins.
            </>
          }
        />
        <StatCardGrid variant="grid">
          <StatCard icon={IconCheck} color="var(--mint)" label="Leading" value={summary.leading} valueColor="var(--mint)" />
          <StatCard icon={IconFlag} color="var(--red)" label="Trailing" value={summary.trailing} valueColor="var(--red)" />
          <StatCard icon={IconUsers} color="var(--muted)" label="Tied" value={summary.tied} />
        </StatCardGrid>
      </section>

      <section className="sec">
        <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
          <button
            className={`chip-filter ${trailingOnly ? "on" : ""}`}
            onClick={() => setTrailingOnly((v) => !v)}
          >
            Trailing only <span className="portmeta">{summary.trailing}</span>
          </button>
        </div>
        <div
          className="field"
          style={{ marginBottom: 0, gap: 12, position: "sticky", top: 0, zIndex: 1, background: "var(--ink)", padding: "8px 0" }}
        >
          {(["margin", "name", "myPoints", "opponentPoints"] as SortKey[]).map((k) => (
            <button
              key={k}
              className={`sorth ${sortBy === k ? "on" : ""}`}
              onClick={() => setSortBy(k)}
            >
              {k === "margin"
                ? "Closest"
                : k === "name"
                  ? "League"
                  : k === "myPoints"
                    ? "My points"
                    : "Opponent points"}
            </button>
          ))}
        </div>

        <DataTable>
          {sorted.map((r) => (
            <TableRow as="link" href={`/manager/${r.leagueId}/matchup`} key={r.leagueId}>
              <span className="tname" style={{ flex: 1 }}>{r.leagueName}</span>
              <span style={{ minWidth: 130, textAlign: "right" }}>
                <span className="portmeta" style={{ display: "block" }}>
                  {r.myPoints.toFixed(1)} vs{" "}
                  {r.opponentPoints != null ? r.opponentPoints.toFixed(1) : "—"}
                  {r.opponentTeamName ? ` (${r.opponentTeamName})` : ""}
                </span>
                {(r.myProjPoints != null || r.opponentProjPoints != null) && (
                  <span className="portmeta" style={{ fontSize: 11, color: "var(--dim)" }}>
                    proj {r.myProjPoints != null ? r.myProjPoints.toFixed(1) : "—"} vs{" "}
                    {r.opponentProjPoints != null ? r.opponentProjPoints.toFixed(1) : "—"}
                  </span>
                )}
              </span>
              <Margin value={r.margin} />
            </TableRow>
          ))}
          {sorted.length === 0 && (
            <p className="hint" style={{ padding: "16px 0" }}>
              {rows.length === 0
                ? "No matchups synced yet — matchups appear once a league is in season."
                : "No trailing matchups right now."}
            </p>
          )}
        </DataTable>
        {sorted.length > 0 && (
          <div className="hint" style={{ marginTop: 8 }}>
            {sorted.length} matchup{sorted.length === 1 ? "" : "s"} shown
            {sorted.length !== rows.length ? ` of ${rows.length}` : ""}
          </div>
        )}
      </section>
    </>
  );
}
