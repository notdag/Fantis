"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { posChipStyle } from "@/lib/players";
import { automationConnected } from "@/lib/manager";
import { useSeasonTotals, pickDropCandidate } from "@/lib/useDropCandidates";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { getTrendingAdds, getTrendingDrops, type TrendingPlayer } from "@/lib/sleeper";
import { EMPTY_PREFS, loadPrefs, type PlayerPrefs } from "@/lib/playerPrefs";
import { classifyTransactions, type Claim } from "@/lib/inbox";
import { cancelWaiverClaim, fetchLeagueTransactions } from "@/lib/sleeperWrite";
import { runBulk, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { PlayerAvatar } from "./Avatar";
import { IconArrowUp, IconArrowDown, IconSearch, IconDollar, IconStar, IconUsers } from "./MgrIcons";
import { PageHead, SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { StatusCell } from "./BulkConfirm";
import ConnectWriteAccess from "./ConnectWriteAccess";
import BulkAdd from "./BulkAdd";
import { useRefreshLeagues } from "./useRefreshLeagues";
import type { LineupLeague } from "./LineupManager";
import type { PlayerMapEntry } from "@/lib/types";

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

export interface FaabLeague {
  leagueId: string;
  leagueName: string;
  budget: number;
  used: number;
  remaining: number;
}

const OFFENSE_POS = new Set(["QB", "RB", "WR", "TE"]);

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

export interface WaiverHistoryEntry {
  leagueName: string;
  waiverPosition: number | null;
  faabUsed: number | null;
}

export default function WaiverAssistant({
  leagues,
  multiAddLeagues,
  faabLeagues,
  automationLastPingAt,
  waiverHistoryBySeason,
}: {
  leagues: WaiverLeague[];
  multiAddLeagues: LineupLeague[];
  faabLeagues: FaabLeague[];
  automationLastPingAt: string | null;
  waiverHistoryBySeason?: Record<string, WaiverHistoryEntry[]>;
}) {
  const router = useRouter();
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const syncWaiverHistory = async () => {
    if (syncingHistory) return;
    setSyncingHistory(true);
    setHistoryError("");
    try {
      const res = await fetch("/api/manager/waiver-history/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setHistoryError(body.error || "Couldn't sync waiver history.");
        return;
      }
      router.refresh();
    } catch {
      setHistoryError("Couldn't reach the server.");
    } finally {
      setSyncingHistory(false);
    }
  };
  // Same hydration-safety pattern as ManagerDashboard.tsx — automationConnected()
  // depends on Date.now(), so it's gated behind `mounted` to keep the server
  // render and the client's first hydration pass identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const connected = mounted && automationConnected(automationLastPingAt);

  const { pmap, loading: pmapLoading, error: pmapError, retry: retryPmap } = usePlayerMap();

  // Sleeper's own real "who's moving right now" — platform-wide, not scoped
  // to your leagues, so this is informational (who to look for), not a
  // per-league availability check. That's what the search box + multi-add
  // board below are for.
  const [trendingAdds, setTrendingAdds] = useState<TrendingPlayer[] | null>(null);
  const [trendingDrops, setTrendingDrops] = useState<TrendingPlayer[] | null>(null);
  useEffect(() => {
    getTrendingAdds(24, 5).then(setTrendingAdds).catch(() => setTrendingAdds([]));
    getTrendingDrops(24, 5).then(setTrendingDrops).catch(() => setTrendingDrops([]));
  }, []);

  const [multiAddToken, setMultiAddToken] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PlayerPrefs>(EMPTY_PREFS);
  useEffect(() => {
    let cancelled = false;
    loadPrefs()
      .then((p) => { if (!cancelled) setPrefs(p); })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Real pending waiver claims across every league — same underlying
  // parser as the Trades & Claims inbox (lib/inbox.ts's classifyTransactions,
  // reads Sleeper's private per-league transaction feed), just claims only
  // (no trades) and using the write-access token already connected above
  // for the multi-add board, so there's no second "connect" step. Nothing
  // is checked in the background — scan when you want a fresh look, same
  // as the inbox.
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimsScanned, setClaimsScanned] = useState(false);
  const [claimsScanning, setClaimsScanning] = useState(false);
  const [claimsProgress, setClaimsProgress] = useState({ done: 0, failed: 0 });
  const [claimsErrors, setClaimsErrors] = useState<string[]>([]);
  const claimsAbort = useRef({ aborted: false });
  const [claimSelected, setClaimSelected] = useState<Set<string>>(new Set());
  const [claimStatus, setClaimStatus] = useState<Record<string, TaskStatus>>({});
  const [cancelling, setCancelling] = useState(false);
  const [cancelSummary, setCancelSummary] = useState("");
  const cancelAbort = useRef({ aborted: false });
  const refreshLeagues = useRefreshLeagues();

  const scanClaims = async () => {
    if (!multiAddToken) return;
    setClaimsScanning(true);
    setClaimsScanned(false);
    setClaims([]);
    setClaimsErrors([]);
    setClaimsProgress({ done: 0, failed: 0 });
    setClaimSelected(new Set());
    setClaimStatus({});
    setCancelSummary("");
    claimsAbort.current = { aborted: false };
    const acc: Claim[] = [];
    const tasks: BulkTask[] = multiAddLeagues
      .filter((l) => l.roster)
      .map((l) => ({
        key: l.league.id,
        run: async () => {
          const raw = await fetchLeagueTransactions(multiAddToken, { leagueId: l.league.id, rosterId: l.roster!.rosterId });
          const { claims: c } = classifyTransactions(l.league.id, l.roster!.rosterId, raw);
          acc.push(...c);
        },
      }));
    const result = await runBulk(tasks, {
      concurrency: 5,
      gapMs: 50,
      signal: claimsAbort.current,
      onStatus: (key, s) => {
        if (s.kind === "done") {
          setClaimsProgress((p) => ({ ...p, done: p.done + 1 }));
          setClaims([...acc]);
        } else if (s.kind === "failed") {
          setClaimsProgress((p) => ({ done: p.done + 1, failed: p.failed + 1 }));
          const name = multiAddLeagues.find((l) => l.league.id === key)?.league.name ?? key;
          setClaimsErrors((prev) => (prev.length < 20 ? [...prev, `${name}: ${s.message}`] : prev));
        }
      },
    });
    setClaims([...acc]);
    setClaimsScanning(false);
    setClaimsScanned(true);
    if (result.stoppedForAuth) setClaimsErrors((p) => ["Stopped early — Sleeper rejected the login token; reconnect above.", ...p]);
  };

  const openClaims = claims.filter((c) => claimStatus[c.key]?.kind !== "done");
  const selectedClaims = openClaims.filter((c) => claimSelected.has(c.key));
  const claimLeagueName = (id: string) => multiAddLeagues.find((l) => l.league.id === id)?.league.name ?? id;
  const toggleClaim = (key: string) =>
    setClaimSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const cancelSelectedClaims = async () => {
    if (!multiAddToken || cancelling) return;
    const list = selectedClaims;
    if (list.length === 0) return;
    setCancelling(true);
    setCancelSummary("");
    cancelAbort.current = { aborted: false };
    const doneLeagues: string[] = [];
    const tasks: BulkTask[] = list.map((c) => ({
      key: c.key,
      run: async () => {
        await cancelWaiverClaim(multiAddToken, { leagueId: c.leagueId, transactionId: c.transactionId, leg: c.leg });
        doneLeagues.push(c.leagueId);
      },
    }));
    const result = await runBulk(tasks, {
      concurrency: 3,
      signal: cancelAbort.current,
      onStatus: (key, s) => setClaimStatus((prev) => ({ ...prev, [key]: s })),
    });
    setCancelling(false);
    setClaimSelected(new Set());
    const refreshed = result.done > 0 ? await refreshLeagues(doneLeagues) : null;
    setCancelSummary(
      `Cancelled ${result.done}${result.failed ? `, ${result.failed} failed` : ""}.${
        result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : ""
      }${refreshed === null ? "" : refreshed ? " Fantis's data was refreshed for those leagues." : ""}`
    );
  };

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
          description={
            <>
              Every in-season league you&rsquo;re actually managing (best ball excluded) — real FAAB
              remaining, every pending waiver claim, who&rsquo;s trending on Sleeper right now, adding
              several players at once, or one target&rsquo;s real per-league drop math.
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
      </section>

      <section className="sec">
        <ConnectWriteAccess onTokenReady={setMultiAddToken} />
      </section>

      {faabLeagues.length > 0 && (
        <section className="sec">
          <SectionHead
            title="FAAB remaining"
            right={`$${faabLeagues.reduce((sum, l) => sum + l.remaining, 0)} left across ${faabLeagues.length} league${faabLeagues.length === 1 ? "" : "s"}`}
          />
          <p className="hint" style={{ margin: "0 0 12px" }}>
            Real budget minus what&rsquo;s already been spent, per league — leagues without FAAB
            (reverse-standings/rolling waivers) aren&rsquo;t shown, since there&rsquo;s no budget to run
            out of. Sorted lowest-remaining first.
          </p>
          <DataTable>
            {faabLeagues.map((l) => (
              <TableRow as="static" key={l.leagueId}>
                <span className="tname" style={{ flex: 1 }}>{l.leagueName}</span>
                <span className="portmeta">${l.used} used of ${l.budget}</span>
                <span
                  className="portmeta"
                  style={{ fontWeight: 600, minWidth: 70, textAlign: "right", color: l.remaining === 0 ? "var(--red)" : l.remaining < l.budget * 0.2 ? "var(--amber)" : "var(--mint)" }}
                >
                  ${l.remaining} left
                </span>
              </TableRow>
            ))}
          </DataTable>
        </section>
      )}

      <section className="sec">
        <SectionHead
          title="Pending waiver claims"
          right={claimsScanned ? `${openClaims.length} pending` : undefined}
        />
        <p className="hint" style={{ margin: "0 0 12px" }}>
          Every real waiver claim you&rsquo;ve submitted that Sleeper hasn&rsquo;t resolved yet, across
          every league — same real data the Trades &amp; Claims inbox reads, just scoped to claims and
          using the write access connected above. Nothing is checked in the background — scan for a
          fresh look.
        </p>
        <div className="field" style={{ marginBottom: 8, alignItems: "center" }}>
          {claimsScanning ? (
            <button className="btn ghost" onClick={() => (claimsAbort.current.aborted = true)}>Abort scan</button>
          ) : (
            <button className="btn" disabled={!multiAddToken || multiAddLeagues.length === 0} onClick={scanClaims}>
              {claimsScanned ? "Rescan" : `Scan ${multiAddLeagues.length} leagues`}
            </button>
          )}
          {claimsScanned && (
            <span className="portmeta">{claimsProgress.done}/{multiAddLeagues.length} leagues checked{claimsProgress.failed ? `, ${claimsProgress.failed} failed` : ""}</span>
          )}
        </div>
        {!multiAddToken && <p className="hint" style={{ color: "var(--red)" }}>Connect write access above first.</p>}
        {claimsErrors.length > 0 && (
          <div className="err">
            {claimsErrors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
            {claimsErrors.length > 5 && <div>…and {claimsErrors.length - 5} more league errors</div>}
          </div>
        )}
        {cancelSummary && <p className="hint" style={{ color: "var(--bone)" }}>{cancelSummary}</p>}
        {!claimsScanned && !claimsScanning && <p className="hint">Run a scan to load your pending claims.</p>}
        {claimsScanned && openClaims.length === 0 && <p className="hint">No pending waiver claims right now.</p>}
        {claimsScanned && openClaims.length > 0 && (
          <>
            <div className="field" style={{ marginBottom: 8 }}>
              <button
                className="btn ghost sm"
                disabled={!multiAddToken || cancelling || selectedClaims.length === 0}
                onClick={() => void cancelSelectedClaims()}
              >
                {cancelling ? "Cancelling…" : `Cancel selected (${selectedClaims.length})`}
              </button>
            </div>
            <DataTable>
              <TableHeaderRow>
                <span style={{ width: 22 }} />
                <span style={{ flex: 1 }}>League · claim</span>
                <span style={{ minWidth: 60 }}>Bid</span>
                <span style={{ minWidth: 110 }}>Status</span>
                <span style={{ minWidth: 90 }}>Result</span>
              </TableHeaderRow>
              {openClaims.map((c) => (
                <TableRow key={c.key}>
                  <input type="checkbox" checked={claimSelected.has(c.key)} disabled={cancelling} onChange={() => toggleClaim(c.key)} />
                  <span className="tname" style={{ flex: 1 }}>
                    {pmap?.[c.addId ?? ""]?.n ?? c.addId ?? "—"}
                    {c.dropId && <span className="portmeta" style={{ fontWeight: 400 }}> · drop {pmap?.[c.dropId]?.n ?? c.dropId}</span>}
                    <span className="portmeta" style={{ display: "block", fontWeight: 400 }}>{claimLeagueName(c.leagueId)}</span>
                  </span>
                  <span className="portmeta" style={{ minWidth: 60 }}>{c.bid != null ? `$${c.bid}` : "—"}</span>
                  <span className="portmeta" style={{ minWidth: 110 }} title="Sleeper's raw status">{c.status}</span>
                  <StatusCell status={claimStatus[c.key]} />
                </TableRow>
              ))}
            </DataTable>
          </>
        )}
      </section>

      <section className="sec">
        <SectionHead title="Hottest adds &amp; drops" right="last 24h across Sleeper" />
        <p className="hint" style={{ margin: "0 0 12px" }}>
          Sleeper&rsquo;s own real trending list, platform-wide — not scoped to your leagues, so
          it&rsquo;s who to look for, not a guarantee he&rsquo;s actually available in yours. Search him
          below to check.
        </p>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", minWidth: 240 }}>
            <p className="portmeta" style={{ color: "var(--mint)", fontWeight: 600, margin: "0 0 6px" }}>Most added</p>
            {trendingAdds === null ? (
              <p className="hint">Loading…</p>
            ) : trendingAdds.length === 0 ? (
              <p className="hint">Couldn&rsquo;t load trending adds.</p>
            ) : (
              <DataTable>
                {trendingAdds.map((t, i) => {
                  const p = pmap?.[t.player_id];
                  return (
                    <TableRow
                      as="button"
                      key={t.player_id}
                      onClick={() => {
                        setSelectedId(t.player_id);
                        setQuery(p?.n ?? t.player_id);
                      }}
                    >
                      <span className="portmeta" style={{ minWidth: 16 }}>{i + 1}</span>
                      <PlayerAvatar playerId={t.player_id} pos={p?.p} size={26} />
                      <span className="tname" style={{ flex: 1 }}>{p?.n ?? t.player_id}</span>
                      {p?.p && <span className="pos" style={posChipStyle(p.p)}>{p.p}</span>}
                      <span className="portmeta">{p?.t ?? ""}</span>
                    </TableRow>
                  );
                })}
              </DataTable>
            )}
          </div>
          <div style={{ flex: "1 1 260px", minWidth: 240 }}>
            <p className="portmeta" style={{ color: "var(--red)", fontWeight: 600, margin: "0 0 6px" }}>Most dropped</p>
            {trendingDrops === null ? (
              <p className="hint">Loading…</p>
            ) : trendingDrops.length === 0 ? (
              <p className="hint">Couldn&rsquo;t load trending drops.</p>
            ) : (
              <DataTable>
                {trendingDrops.map((t, i) => {
                  const p = pmap?.[t.player_id];
                  return (
                    <TableRow as="static" key={t.player_id}>
                      <span className="portmeta" style={{ minWidth: 16 }}>{i + 1}</span>
                      <PlayerAvatar playerId={t.player_id} pos={p?.p} size={26} />
                      <span className="tname" style={{ flex: 1 }}>{p?.n ?? t.player_id}</span>
                      {p?.p && <span className="pos" style={posChipStyle(p.p)}>{p.p}</span>}
                      <span className="portmeta">{p?.t ?? ""}</span>
                    </TableRow>
                  );
                })}
              </DataTable>
            )}
          </div>
        </div>
      </section>

      <section className="sec">
        <SectionHead
          title="Add several players at once"
          right={`${multiAddLeagues.length} league${multiAddLeagues.length === 1 ? "" : "s"}`}
        />
        <BulkAdd leagues={multiAddLeagues} pmap={pmap} token={multiAddToken} prefs={prefs} />
      </section>

      <section className="sec" style={{ paddingBottom: 0 }}>
        <SectionHead title="Single-player lookup" right="opens Sleeper for you to review and submit" />
        <div className="field" style={{ maxWidth: 360, marginTop: 4 }}>
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

        {!selectedId && query.trim().length >= 2 && pmapError && (
          <p className="hint" style={{ marginTop: 8 }}>
            Couldn&rsquo;t load player data.{" "}
            <button type="button" className="link" onClick={retryPmap}>
              Retry
            </button>
          </p>
        )}
        {!selectedId && query.trim().length >= 2 && pmapLoading && !pmapError && (
          <p className="hint" style={{ marginTop: 8 }}>Loading real player data…</p>
        )}
        {!selectedId && !pmapLoading && !pmapError && searchResults.length > 0 && (
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
                  <PlayerAvatar playerId={id} pos={p.p} size={28} />
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
        {!selectedId && !pmapLoading && !pmapError && query.trim().length >= 2 && searchResults.length === 0 && (
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
              borderRadius: 8,
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
                <PlayerAvatar playerId={selectedId} pos={pmap?.[selectedId]?.p} size={40} />
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
                          <PlayerAvatar playerId={drop.playerId} pos={label?.p} size={26} />
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

      <section className="sec">
        <SectionHead
          title="Waiver history"
          right={
            <button className="btn ghost sm" onClick={syncWaiverHistory} disabled={syncingHistory}>
              {syncingHistory ? "Syncing…" : "Sync waiver history"}
            </button>
          }
        />
        {historyError && <div className="err">{historyError}</div>}
        {!waiverHistoryBySeason || Object.keys(waiverHistoryBySeason).length === 0 ? (
          <p className="hint">
            No past-season waiver data synced yet — real FAAB/waiver-position usage from prior
            seasons, not shown until you run a sync. This is a separate, on-demand sync (not part
            of the main Refresh button) since it covers real past-season leagues too.
          </p>
        ) : (
          Object.entries(waiverHistoryBySeason)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([season, entries]) => (
              <div key={season} style={{ marginTop: 12 }}>
                <SectionHead level={3} title={season} right={`${entries.length} leagues`} style={{ marginBottom: 8 }} />
                <DataTable>
                  {entries.map((e, i) => (
                    <TableRow key={`${e.leagueName}-${i}`}>
                      <span className="tname" style={{ flex: 1 }}>{e.leagueName}</span>
                      <span className="portmeta">
                        {e.waiverPosition != null ? `waiver #${e.waiverPosition}` : "—"}
                      </span>
                      <span className="portmeta">
                        {e.faabUsed != null ? `$${e.faabUsed} FAAB used` : "—"}
                      </span>
                    </TableRow>
                  ))}
                </DataTable>
              </div>
            ))
        )}
      </section>
    </>
  );
}
