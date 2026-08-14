"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { alertSeverityChipStyle } from "@/lib/manager";
import { IconFlag, IconCheck, IconUsers } from "./MgrIcons";
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

function Avatar({ playerId, pos, size }: { playerId: string; pos?: string; size: number }) {
  const ring = pos ? posChipStyle(pos).color : "var(--line)";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="mgravatar"
      src={playerPhotoUrl(playerId)}
      alt=""
      style={{ width: size, height: size, borderColor: ring }}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

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
    <div className="mgrtable">
      {list.map((r) => (
        <Link href={`/manager/${r.leagueId}`} className="mgrrow" key={r.leagueId}>
          <span className="tname" style={{ flex: 1 }}>{r.leagueName}</span>
          {severity && (
            <span className="pos" style={alertSeverityChipStyle(severity)}>
              {severity === "action_required" ? "needs attention" : severity === "review" ? "review" : "clear"}
            </span>
          )}
        </Link>
      ))}
    </div>
  );

  const selected = selectedId ? pmap?.[selectedId] : null;

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Player search</h1>
          <p>
            Search any player to see where he stands across every synced league — starting, bench,
            not rostered, and which leagues have a real alert tied to him.
          </p>
        </div>

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
          <div className="mgrtable" style={{ marginTop: 8, maxWidth: 400 }}>
            {searchResults.map(([id, p]) => (
              <button
                key={id}
                className="mgrrow"
                style={{ border: "none" }}
                onClick={() => {
                  setSelectedId(id);
                  setQuery(p.n);
                }}
              >
                <Avatar playerId={id} pos={p.p} size={28} />
                <span className="tname" style={{ flex: 1 }}>{p.n}</span>
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
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar playerId={selectedId} pos={selected?.p} size={40} />
                <h2 style={{ fontSize: 18, margin: 0 }}>{selected?.n ?? selectedId}</h2>
              </div>
              <span className="rt">
                rostered in {starting.length + bench.length} of {leagues.length} leagues
              </span>
            </div>
            <div className="mgrstats">
              <div className="mgrstat">
                <div
                  className="mgrstaticon"
                  style={{ color: "var(--red)", background: "color-mix(in srgb, var(--red) 16%, transparent)" }}
                >
                  <IconFlag width={17} height={17} />
                </div>
                <div className="mgrstatbody">
                  <p className="mgrstatlabel">Starting, needs attention</p>
                  <p className="mgrstatvalue" style={{ color: "var(--red)" }}>{startingAttention.length}</p>
                </div>
              </div>
              <div className="mgrstat">
                <div
                  className="mgrstaticon"
                  style={{ color: "var(--mint)", background: "color-mix(in srgb, var(--mint) 16%, transparent)" }}
                >
                  <IconCheck width={17} height={17} />
                </div>
                <div className="mgrstatbody">
                  <p className="mgrstatlabel">Starting, clear</p>
                  <p className="mgrstatvalue" style={{ color: "var(--mint)" }}>{startingClear.length}</p>
                </div>
              </div>
              <div className="mgrstat">
                <div
                  className="mgrstaticon"
                  style={{ color: "var(--muted)", background: "color-mix(in srgb, var(--muted) 16%, transparent)" }}
                >
                  <IconUsers width={17} height={17} />
                </div>
                <div className="mgrstatbody">
                  <p className="mgrstatlabel">Bench</p>
                  <p className="mgrstatvalue">{bench.length}</p>
                </div>
              </div>
              <div className="mgrstat">
                <div
                  className="mgrstaticon"
                  style={{ color: "var(--dim)", background: "color-mix(in srgb, var(--dim) 16%, transparent)" }}
                >
                  <IconUsers width={17} height={17} />
                </div>
                <div className="mgrstatbody">
                  <p className="mgrstatlabel">Not rostered</p>
                  <p className="mgrstatvalue">{notRostered.length}</p>
                </div>
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
