"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getPlayers } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { alertSeverityChipStyle } from "@/lib/manager";
import type { PlayerMap, PlayerMapEntry } from "@/lib/types";

export interface PlayerLeagueRow {
  leagueId: string;
  leagueName: string;
  players: string[];
  starters: string[];
}

export interface PlayerAlertRef {
  leagueId: string;
  playerId: string;
}

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE"]);

type Status = "starting" | "bench" | "not_rostered";

export default function PlayerLeagues({
  leagues,
  alertRefs,
}: {
  leagues: PlayerLeagueRow[];
  alertRefs: PlayerAlertRef[];
}) {
  const [pmap, setPmap] = useState<PlayerMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPlayers()
      .then((m) => {
        if (!cancelled) setPmap(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNotRostered, setShowNotRostered] = useState(false);

  const searchResults = useMemo(() => {
    if (!pmap) return [];
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const matches: [string, PlayerMapEntry][] = [];
    for (const [id, p] of Object.entries(pmap)) {
      if (OFFENSE_POS.has(p.p) && p.n.toLowerCase().includes(q)) matches.push([id, p]);
    }
    matches.sort((a, b) => a[1].n.localeCompare(b[1].n));
    return matches.slice(0, 20);
  }, [pmap, query]);

  const attentionKeys = useMemo(() => {
    const set = new Set<string>();
    for (const a of alertRefs) set.add(`${a.leagueId}:${a.playerId}`);
    return set;
  }, [alertRefs]);

  const rows = useMemo(() => {
    if (!selectedId) return [];
    return leagues.map((lg) => {
      let status: Status = "not_rostered";
      if (lg.players.includes(selectedId)) {
        status = lg.starters.includes(selectedId) ? "starting" : "bench";
      }
      const needsAttention = attentionKeys.has(`${lg.leagueId}:${selectedId}`);
      return { leagueId: lg.leagueId, leagueName: lg.leagueName, status, needsAttention };
    });
  }, [leagues, selectedId, attentionKeys]);

  const starting = rows.filter((r) => r.status === "starting");
  const startingAttention = starting.filter((r) => r.needsAttention);
  const startingClear = starting.filter((r) => !r.needsAttention);
  const bench = rows.filter((r) => r.status === "bench");
  const notRostered = rows.filter((r) => r.status === "not_rostered");

  const renderRows = (list: typeof rows, severity: "action_required" | "review" | "clear" | null) => (
    <div className="portoverview">
      {list.map((r) => (
        <Link href={`/manager/${r.leagueId}`} className="portoverviewrow" key={r.leagueId}>
          <span className="tname">{r.leagueName}</span>
          {severity && (
            <span className="pos" style={alertSeverityChipStyle(severity)}>
              {severity === "action_required" ? "needs attention" : severity === "review" ? "review" : "clear"}
            </span>
          )}
        </Link>
      ))}
    </div>
  );

  return (
    <>
      <section className="sec">
        <div className="sechead">
          <h2>Player search</h2>
          <Link href="/manager" className="link">
            ← Sleeper Manager
          </Link>
        </div>
        <p className="hint">
          Search any player to see where he stands across every synced league — starting, bench,
          not rostered, and which leagues have a real alert tied to him.
        </p>

        <div className="field" style={{ maxWidth: 360 }}>
          <input
            className="input"
            placeholder="Search a player…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedId(null);
            }}
          />
        </div>

        {!selectedId && searchResults.length > 0 && (
          <div className="portoverview" style={{ marginTop: 8, maxWidth: 360 }}>
            {searchResults.map(([id, p]) => (
              <button
                key={id}
                className="portoverviewrow"
                style={{ width: "100%", textAlign: "left", border: "none", background: "none", cursor: "pointer" }}
                onClick={() => {
                  setSelectedId(id);
                  setQuery(p.n);
                }}
              >
                <span className="tname">{p.n}</span>
                <span className="pos" style={posChipStyle(p.p)}>
                  {p.p}
                </span>
                <span className="portmeta">{p.t}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedId && (
        <>
          <section className="sec">
            <div className="sechead">
              <h2 style={{ fontSize: 18 }}>{pmap?.[selectedId]?.n ?? selectedId}</h2>
              <span className="rt">
                rostered in {starting.length + bench.length} of {leagues.length} leagues
              </span>
            </div>
            <div className="portsummary">
              <div className="portcard">
                <div className="portcardhead">Starting, needs attention</div>
                <p className="portcardtitle" style={{ fontSize: 22, margin: 0, color: "var(--red)" }}>
                  {startingAttention.length}
                </p>
              </div>
              <div className="portcard">
                <div className="portcardhead">Starting, clear</div>
                <p className="portcardtitle" style={{ fontSize: 22, margin: 0, color: "var(--mint)" }}>
                  {startingClear.length}
                </p>
              </div>
              <div className="portcard">
                <div className="portcardhead">Bench</div>
                <p className="portcardtitle" style={{ fontSize: 22, margin: 0 }}>{bench.length}</p>
              </div>
              <div className="portcard">
                <div className="portcardhead">Not rostered</div>
                <p className="portcardtitle" style={{ fontSize: 22, margin: 0 }}>{notRostered.length}</p>
              </div>
            </div>
          </section>

          {startingAttention.length > 0 && (
            <section className="sec">
              <div className="sechead">
                <h2 style={{ fontSize: 18 }}>Starting — needs attention</h2>
                <span className="rt">{startingAttention.length} leagues</span>
              </div>
              {renderRows(startingAttention, "action_required")}
            </section>
          )}

          {startingClear.length > 0 && (
            <section className="sec">
              <div className="sechead">
                <h2 style={{ fontSize: 18 }}>Starting — clear</h2>
                <span className="rt">{startingClear.length} leagues</span>
              </div>
              {renderRows(startingClear, "clear")}
            </section>
          )}

          {bench.length > 0 && (
            <section className="sec">
              <div className="sechead">
                <h2 style={{ fontSize: 18 }}>Bench</h2>
                <span className="rt">{bench.length} leagues</span>
              </div>
              {renderRows(bench, null)}
            </section>
          )}

          {notRostered.length > 0 && (
            <section className="sec">
              <div className="sechead">
                <h2 style={{ fontSize: 18 }}>Not rostered</h2>
                <button className="chip-filter" onClick={() => setShowNotRostered((v) => !v)}>
                  {showNotRostered ? "Hide" : `Show ${notRostered.length} leagues`}
                </button>
              </div>
              {showNotRostered && renderRows(notRostered, null)}
            </section>
          )}
        </>
      )}
    </>
  );
}
