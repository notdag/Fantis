"use client";

import { useEffect, useMemo, useState } from "react";
import { getPlayers, playerPhotoUrl } from "@/lib/sleeper";
import { posChipStyle } from "@/lib/players";
import { automationConnected } from "@/lib/manager";
import { useSeasonTotals, pickDropCandidate } from "@/lib/useDropCandidates";
import { IconArrowUp, IconArrowDown, IconSearch, IconDollar, IconStar, IconUsers } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow } from "./DataRow";
import type { PlayerMap, PlayerMapEntry } from "@/lib/types";

export interface WaiverLeague {
  leagueId: string;
  leagueName: string;
  players: string[];
  starters: string[];
  // Every real player rostered by ANY team in this league — a true
  // "is he actually available" check, not just "not on my roster."
  allRosteredPlayers: string[];
  waiverPosition: number | null;
  faabUsed: number | null;
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

  const waiverSummary = useMemo(() => {
    const withFaab = leagues.filter((lg) => lg.faabUsed != null);
    const faabTotal = withFaab.reduce((sum, lg) => sum + (lg.faabUsed ?? 0), 0);
    const withPosition = leagues.filter((lg) => lg.waiverPosition != null);
    let best: WaiverLeague | null = null;
    for (const lg of withPosition) {
      if (!best || (lg.waiverPosition as number) < (best.waiverPosition as number)) best = lg;
    }
    const avgPosition =
      withPosition.length > 0
        ? withPosition.reduce((sum, lg) => sum + (lg.waiverPosition ?? 0), 0) / withPosition.length
        : null;
    return { faabTotal, faabLeagues: withFaab.length, best, avgPosition, positionLeagues: withPosition.length };
  }, [leagues]);

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
        // Real league-wide check, not just "not on my roster" — every
        // other team's roster in this league is real data now too (see
        // LeagueRoster in prisma/schema.prisma), so this is honest about
        // whether a claim could actually go through.
        takenByOther: lg.allRosteredPlayers.includes(selectedId),
      }));
  }, [leagues, selectedId, seasonTotals]);

  // Reset selection to "every league where he's a true free agent" whenever
  // the target player changes — leagues where another team already has him
  // start unchecked (and disabled below), since queuing those would open a
  // waiver page for a claim that can't go through.
  useEffect(() => {
    if (!selectedId) {
      setCheckedIds(new Set());
      return;
    }
    const ids = leagues
      .filter((lg) => !lg.players.includes(selectedId) && !lg.allRosteredPlayers.includes(selectedId))
      .map((lg) => lg.leagueId);
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
        <PageHead
          title="Waiver Assistant"
          description={
            <>
              Search a free-agent target, see which of your leagues don&rsquo;t already have him,
              and get a real season-points drop suggestion per league. This only opens
              Sleeper&rsquo;s real page for you to review — it never submits a claim on its own.
            </>
          }
        />

        {!selectedId && (waiverSummary.faabLeagues > 0 || waiverSummary.positionLeagues > 0) && (
          <StatCardGrid variant="hero">
            <StatCard
              icon={IconDollar}
              color="var(--amber)"
              label="Total FAAB used"
              value={`$${waiverSummary.faabTotal}`}
              valueColor="var(--amber)"
              sub={`across ${waiverSummary.faabLeagues} leagues tracking FAAB`}
            />
            <StatCard
              icon={IconStar}
              color={waiverSummary.best?.waiverPosition === 1 ? "var(--mint)" : "var(--muted)"}
              label="Best waiver position"
              value={waiverSummary.best?.waiverPosition ?? "—"}
              sub={waiverSummary.best ? `in ${waiverSummary.best.leagueName}` : undefined}
            />
            <StatCard
              icon={IconUsers}
              color="var(--muted)"
              label="Avg waiver position"
              value={waiverSummary.avgPosition != null ? waiverSummary.avgPosition.toFixed(1) : "—"}
              sub={`${waiverSummary.positionLeagues} leagues on waivers`}
            />
          </StatCardGrid>
        )}

        <div className="field" style={{ maxWidth: 360, marginTop: 16 }}>
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

      {selectedId && (
        <section className="sec">
          <SectionHead
            title={
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar playerId={selectedId} pos={pmap?.[selectedId]?.p} size={40} />
                <span>
                  <span style={{ display: "block" }}>{pmap?.[selectedId]?.n ?? selectedId}</span>
                  <span className="portmeta">
                    {selectedSeasonPts != null ? `${Math.round(selectedSeasonPts)} proj season pts` : "no season projection"}
                  </span>
                </span>
              </span>
            }
            right={`${candidateLeagues.filter((c) => !c.takenByOther).length} of ${candidateLeagues.length} league${candidateLeagues.length === 1 ? "" : "s"} without him actually available`}
          />

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
              <DataTable>
                {candidateLeagues.map(({ leagueId, leagueName, drop, takenByOther }) => {
                  const label = drop ? pmap?.[drop.playerId] : null;
                  const diff =
                    selectedSeasonPts != null && drop ? selectedSeasonPts - drop.value : null;
                  return (
                    <TableRow
                      as="label"
                      key={leagueId}
                      style={{ cursor: takenByOther ? "default" : "pointer", opacity: takenByOther ? 0.55 : 1 }}
                    >
                      <input
                        type="checkbox"
                        checked={checkedIds.has(leagueId)}
                        disabled={takenByOther}
                        onChange={() => toggle(leagueId)}
                      />
                      <span className="tname" style={{ flex: 1 }}>
                        {leagueName}
                      </span>
                      {takenByOther ? (
                        <span className="portmeta" style={{ color: "var(--red)" }}>
                          already rostered by another team in this league
                        </span>
                      ) : drop ? (
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
                      {!takenByOther && <Diff value={diff} />}
                    </TableRow>
                  );
                })}
              </DataTable>

              <p className="hint" style={{ marginTop: 10 }}>
                Leagues where another team already has him are shown greyed out and can&rsquo;t be
                queued — a real check against every roster in that league, not just yours. The drop
                suggestion and the Diff column (both real season-projected points, the same numbers
                Rankings and Trade Calculator use) rank purely on projected points, with no
                position-scarcity or roster-rule awareness. Confirm both on Sleeper&rsquo;s real page
                before submitting.
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
