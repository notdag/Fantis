"use client";

import { useEffect, useMemo, useState } from "react";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { alertSeverityChipStyle } from "@/lib/manager";
import { IconFlag, IconCheck, IconUsers, IconSearch } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";
import type { PlayerMap, PlayerMapEntry } from "@/lib/types";

export interface PlayerLeagueRow {
  leagueId: string;
  leagueName: string;
  players: string[];
  starters: string[];
  reserve: string[];
}

export interface PlayerAlertRef {
  leagueId: string;
  playerId: string;
}

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE"]);

type Status = "starting" | "bench" | "ir" | "not_rostered";

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
      if (lg.reserve.includes(selectedId)) {
        status = "ir";
      } else if (lg.players.includes(selectedId)) {
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
  const ir = rows.filter((r) => r.status === "ir");
  const notRostered = rows.filter((r) => r.status === "not_rostered");

  // Real position-exposure breakdown across every synced roster — no
  // search needed, shown as the default view. Pure aggregation over data
  // already fetched (Roster.players + the same pmap this page already
  // loads for search), no new Sleeper calls.
  const exposure = useMemo(() => {
    if (!pmap) return null;
    const counts = new Map<string, Map<string, number>>();
    for (const lg of leagues) {
      for (const playerId of lg.players) {
        const entry = pmap[playerId];
        if (!entry || !OFFENSE_POS.has(entry.p)) continue;
        const byPos = counts.get(entry.p) ?? new Map<string, number>();
        byPos.set(playerId, (byPos.get(playerId) ?? 0) + 1);
        counts.set(entry.p, byPos);
      }
    }
    const out: Record<string, { playerId: string; count: number }[]> = {};
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      const byPos = counts.get(pos);
      if (!byPos) {
        out[pos] = [];
        continue;
      }
      out[pos] = Array.from(byPos.entries())
        .map(([playerId, count]) => ({ playerId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    }
    return out;
  }, [leagues, pmap]);

  const renderRows = (list: typeof rows, severity: "action_required" | "review" | "clear" | null) => (
    <DataTable>
      {list.map((r) => (
        <TableRow as="link" href={`/manager/${r.leagueId}`} key={r.leagueId}>
          <span className="tname" style={{ flex: 1 }}>{r.leagueName}</span>
          {severity && (
            <span className="pos" style={alertSeverityChipStyle(severity)}>
              {severity === "action_required" ? "needs attention" : severity === "review" ? "review" : "clear"}
            </span>
          )}
        </TableRow>
      ))}
    </DataTable>
  );

  const selected = selectedId ? pmap?.[selectedId] : null;

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          title="Player search"
          description="Search any player to see where he stands across every synced league — starting, bench, not rostered, and which leagues have a real alert tied to him."
        />

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
          <div style={{ marginTop: 8, maxWidth: 400 }}>
            <DataTable>
              {searchResults.map(([id, p]) => (
                <TableRow
                  as="button"
                  key={id}
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
                </TableRow>
              ))}
            </DataTable>
          </div>
        )}
        {!selectedId && query.trim().length >= 2 && searchResults.length === 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              padding: "24px 16px",
              marginTop: 8,
              maxWidth: 400,
              border: "1px solid var(--line)",
              borderRadius: 12,
            }}
          >
            <IconSearch width={20} height={20} style={{ color: "var(--dim)" }} />
            <span style={{ color: "var(--bone)", fontSize: 13, fontWeight: 600 }}>No players found</span>
            <span className="hint" style={{ margin: 0 }}>Try a different spelling.</span>
          </div>
        )}
      </section>

      {!selectedId && exposure && (
        <section className="sec">
          <SectionHead title="Position exposure" right={`across ${leagues.length} synced leagues`} />
          <p className="hint" style={{ marginBottom: 12 }}>
            Real ownership counts across every rostered player — no search needed.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
              <div key={pos}>
                <p className="mgrstatlabel" style={{ marginBottom: 6 }}>{pos}</p>
                <DataTable>
                  {exposure[pos].length === 0 && (
                    <TableRow>
                      <span className="hint" style={{ margin: 0 }}>No data yet.</span>
                    </TableRow>
                  )}
                  {exposure[pos].map(({ playerId, count }) => {
                    const entry = pmap?.[playerId];
                    const pct = leagues.length > 0 ? Math.round((count / leagues.length) * 100) : 0;
                    return (
                      <TableRow
                        as="button"
                        key={playerId}
                        onClick={() => {
                          setSelectedId(playerId);
                          setQuery(entry?.n ?? "");
                        }}
                      >
                        <Avatar playerId={playerId} pos={entry?.p} size={22} />
                        <span className="tname" style={{ flex: 1 }}>{entry?.n ?? playerId}</span>
                        <span className="portvalue">{pct}%</span>
                      </TableRow>
                    );
                  })}
                </DataTable>
              </div>
            ))}
          </div>
        </section>
      )}

      {selectedId && (
        <>
          <section className="sec">
            <SectionHead
              title={
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar playerId={selectedId} pos={selected?.p} size={40} />
                  {selected?.n ?? selectedId}
                </span>
              }
              right={`rostered in ${starting.length + bench.length} of ${leagues.length} leagues`}
            />
            <StatCardGrid variant="grid">
              <StatCard
                icon={IconFlag}
                color="var(--red)"
                label="Starting, needs attention"
                value={startingAttention.length}
                valueColor="var(--red)"
              />
              <StatCard
                icon={IconCheck}
                color="var(--mint)"
                label="Starting, clear"
                value={startingClear.length}
                valueColor="var(--mint)"
              />
              <StatCard icon={IconUsers} color="var(--muted)" label="Bench" value={bench.length} />
              <StatCard icon={IconUsers} color="var(--amber)" label="IR" value={ir.length} />
              <StatCard icon={IconUsers} color="var(--dim)" label="Not rostered" value={notRostered.length} />
            </StatCardGrid>
          </section>

          {startingAttention.length > 0 && (
            <section className="sec">
              <SectionHead title="Starting — needs attention" right={`${startingAttention.length} leagues`} />
              {renderRows(startingAttention, "action_required")}
            </section>
          )}

          {startingClear.length > 0 && (
            <section className="sec">
              <SectionHead title="Starting — clear" right={`${startingClear.length} leagues`} />
              {renderRows(startingClear, "clear")}
            </section>
          )}

          {bench.length > 0 && (
            <section className="sec">
              <SectionHead title="Bench" right={`${bench.length} leagues`} />
              {renderRows(bench, null)}
            </section>
          )}

          {ir.length > 0 && (
            <section className="sec">
              <SectionHead title="IR" right={`${ir.length} leagues`} />
              {renderRows(ir, null)}
            </section>
          )}

          {notRostered.length > 0 && (
            <section className="sec">
              <SectionHead
                title="Not rostered"
                right={
                  <button className="chip-filter" onClick={() => setShowNotRostered((v) => !v)}>
                    {showNotRostered ? "Hide" : `Show ${notRostered.length} leagues`}
                  </button>
                }
              />
              {showNotRostered && renderRows(notRostered, null)}
            </section>
          )}
        </>
      )}
    </>
  );
}
