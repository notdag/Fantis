"use client";

import { useEffect, useMemo, useState } from "react";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { automationConnected } from "@/lib/manager";
import { useSeasonTotals, pickDropCandidate } from "@/lib/useDropCandidates";
import { IconArrowUp, IconArrowDown, IconSearch } from "./MgrIcons";
import type { PlayerMap, PlayerMapEntry } from "@/lib/types";

export interface WaiverLeague {
  leagueId: string;
  leagueName: string;
  players: string[];
  starters: string[];
}

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE"]);

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

function Diff({ value }: { value: number | null }) {
  if (value == null) return <span className="portmeta">—</span>;
  const rounded = Math.round(value);
  const color = rounded > 0 ? "var(--mint)" : rounded < 0 ? "var(--red)" : "var(--muted)";
  return (
    <span className="mgrdiff" style={{ color }}>
      {rounded !== 0 && (rounded > 0 ? <IconArrowUp /> : <IconArrowDown />)}
      {rounded > 0 ? "+" : ""}
      {rounded}
    </span>
  );
}

export default function WaiverAssistant({
  leagues,
  automationLastPingAt,
}: {
  leagues: WaiverLeague[];
  automationLastPingAt: string | null;
}) {
  // Same hydration-safety pattern as ManagerDashboard.tsx — automationConnected()
  // depends on Date.now(), so it's gated behind `mounted` to keep the server
  // render and the client's first hydration pass identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const connected = mounted && automationConnected(automationLastPingAt);

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

  const seasonTotals = useSeasonTotals();

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [queueing, setQueueing] = useState(false);
  const [queueResult, setQueueResult] = useState("");

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

  const selectedSeasonPts = selectedId ? seasonTotals?.[selectedId]?.pts ?? null : null;

  const candidateLeagues = useMemo(() => {
    if (!selectedId) return [];
    return leagues
      .filter((lg) => !lg.players.includes(selectedId))
      .map((lg) => ({
        leagueId: lg.leagueId,
        leagueName: lg.leagueName,
        drop: pickDropCandidate(lg.players, lg.starters, seasonTotals),
      }));
  }, [leagues, selectedId, seasonTotals]);

  // Reset selection to "everything checked" whenever the target player
  // changes — candidate-league membership only depends on `leagues` (a
  // stable server prop) and `selectedId`, never on seasonTotals, so this
  // doesn't need to react to the async season-projection fetch.
  useEffect(() => {
    if (!selectedId) {
      setCheckedIds(new Set());
      return;
    }
    const ids = leagues.filter((lg) => !lg.players.includes(selectedId)).map((lg) => lg.leagueId);
    setCheckedIds(new Set(ids));
    setQueueResult("");
  }, [selectedId, leagues]);

  const toggle = (leagueId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
  };

  const queueSelected = async () => {
    if (queueing || checkedIds.size === 0) return;
    setQueueing(true);
    setQueueResult("");
    const ids = Array.from(checkedIds);
    const results = await Promise.allSettled(
      ids.map((leagueId) =>
        fetch("/api/manager/automation/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leagueId, type: "open_waiver" }),
        }).then((res) => {
          if (!res.ok) throw new Error("queue failed");
        })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    setQueueResult(
      `Queued ${ok} league${ok === 1 ? "" : "s"}${failed > 0 ? `, ${failed} failed to queue` : ""}. ` +
        (connected
          ? "Tabs should open within a few seconds."
          : "Browser automation isn't connected — install the userscript from /manager, or open each league yourself.")
    );
    setQueueing(false);
  };

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <div className="mgrhead">
          <div className="mgraccentbar" />
          <h1>Waiver Assistant</h1>
          <p>
            Search a free-agent target, see which of your leagues don&rsquo;t already have him, and
            get a real season-points drop suggestion per league. This only opens Sleeper&rsquo;s real
            page for you to review — it never submits a claim on its own.
          </p>
        </div>

        <div className="field" style={{ maxWidth: 360 }}>
          <input
            className="input"
            placeholder="Search a player to add…"
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

      {selectedId && (
        <section className="sec">
          <div className="sechead">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar playerId={selectedId} pos={pmap?.[selectedId]?.p} size={40} />
              <div>
                <h2 style={{ fontSize: 18, margin: 0 }}>{pmap?.[selectedId]?.n ?? selectedId}</h2>
                <span className="portmeta">
                  {selectedSeasonPts != null ? `${Math.round(selectedSeasonPts)} proj season pts` : "no season projection"}
                </span>
              </div>
            </div>
            <span className="rt">
              {candidateLeagues.length} league{candidateLeagues.length === 1 ? "" : "s"} without him
            </span>
          </div>

          {mounted && !connected && (
            <p className="hint" style={{ color: "var(--dim)" }}>
              ○ Browser automation isn&rsquo;t connected — leagues will still queue, but you&rsquo;ll
              need to open them yourself. <a className="link" href="/manager">Install the userscript</a>.
            </p>
          )}

          {candidateLeagues.length === 0 ? (
            <p className="hint">Every league already has this player on your roster.</p>
          ) : (
            <>
              <div className="mgrtable">
                {candidateLeagues.map(({ leagueId, leagueName, drop }) => {
                  const label = drop ? pmap?.[drop.playerId] : null;
                  const diff =
                    selectedSeasonPts != null && drop ? selectedSeasonPts - drop.value : null;
                  return (
                    <label key={leagueId} className="mgrrow" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(leagueId)}
                        onChange={() => toggle(leagueId)}
                      />
                      <span className="tname" style={{ flex: 1 }}>
                        {leagueName}
                      </span>
                      {drop ? (
                        <div className="mgrplayer">
                          <Avatar playerId={drop.playerId} pos={label?.p} size={26} />
                          <div>
                            <div className="mgrplayername">
                              {label?.n ?? drop.playerId}
                              {!drop.fromBench && (
                                <span className="portmeta" style={{ marginLeft: 6 }}>no bench</span>
                              )}
                            </div>
                            {label?.p && (
                              <span className="pos" style={posChipStyle(label.p)}>
                                {label.p}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="portmeta">suggest drop: —</span>
                      )}
                      <Diff value={diff} />
                    </label>
                  );
                })}
              </div>

              <p className="hint" style={{ marginTop: 10 }}>
                This shows leagues where you don&rsquo;t already have this player — it doesn&rsquo;t
                confirm he&rsquo;s actually available league-wide. The drop suggestion and the Diff
                column (both real season-projected points, the same numbers Rankings and Trade
                Calculator use) rank purely on projected points, with no position-scarcity or
                roster-rule awareness. Confirm both on Sleeper&rsquo;s real page before submitting.
              </p>

              <button
                className="btn"
                style={{ marginTop: 10 }}
                onClick={queueSelected}
                disabled={queueing || checkedIds.size === 0}
              >
                {queueing ? "Queuing…" : `Open ${checkedIds.size} selected league${checkedIds.size === 1 ? "" : "s"}`}
              </button>
              {queueResult && <p className="hint" style={{ marginTop: 8 }}>{queueResult}</p>}
            </>
          )}
        </section>
      )}
    </>
  );
}
