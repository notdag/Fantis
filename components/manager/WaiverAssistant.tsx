"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { posChipStyle } from "@/lib/players";
import { useSeasonTotals } from "@/lib/useDropCandidates";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { getTrendingAdds, getTrendingDrops, type TrendingPlayer } from "@/lib/sleeper";
import { EMPTY_PREFS, loadPrefs, type PlayerPrefs } from "@/lib/playerPrefs";
import { classifyTransactions, type Claim } from "@/lib/inbox";
import { addDropFreeAgent, cancelWaiverClaim, claimWaiver, fetchLeagueTransactions } from "@/lib/sleeperWrite";
import { runBulk, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { suggestBid, type FaabStats } from "@/lib/faabHistory";
import { PlayerAvatar } from "./Avatar";
import { IconArrowUp, IconArrowDown, IconSearch, IconStar, IconUsers } from "./MgrIcons";
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
  rosterId: number;
  players: string[];
  starters: string[];
  reserve: string[];
  // roster_positions.length — 0 means unknown (roster settings not synced),
  // treated as "not full" rather than guessed.
  rosterSize: number;
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
  waiverHistoryBySeason,
}: {
  leagues: WaiverLeague[];
  multiAddLeagues: LineupLeague[];
  faabLeagues: FaabLeague[];
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

  // Real past winning bids for this account's leagues — same source the
  // multi-add board uses, so the single-player lookup's suggested bid is
  // never a blind guess either.
  const [faabStats, setFaabStats] = useState<FaabStats | null>(null);
  useEffect(() => {
    fetch("/api/manager/faab-suggest")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { stats?: FaabStats } | null) => setFaabStats(body?.stats ?? null))
      .catch(() => setFaabStats(null));
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
  // Grouped for the single-player lookup below — so a league already
  // waiting on other real claims is visible right where you're deciding
  // whether to add another one there, not just in the section above.
  const claimsByLeague = useMemo(() => {
    const m = new Map<string, Claim[]>();
    for (const c of openClaims) {
      const arr = m.get(c.leagueId);
      if (arr) arr.push(c);
      else m.set(c.leagueId, [c]);
    }
    return m;
  }, [openClaims]);
  // Which leagues' pending-claim detail is expanded in the single-player
  // lookup table below — click the count to see the real add/drop/bid list
  // instead of a truncated tooltip.
  const [expandedClaimLeagues, setExpandedClaimLeagues] = useState<Set<string>>(new Set());
  const toggleClaimsExpanded = (leagueId: string) =>
    setExpandedClaimLeagues((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
  // Same pattern for "show roster" — real starters/bench/IR for that
  // league, useful even (especially) when there's an open slot and no
  // drop dropdown to look at.
  const [expandedRosterLeagues, setExpandedRosterLeagues] = useState<Set<string>>(new Set());
  const toggleRosterExpanded = (leagueId: string) =>
    setExpandedRosterLeagues((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
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
    const withPosition = leagues.filter((lg) => lg.waiverPosition != null);
    let best: WaiverLeague | null = null;
    for (const lg of withPosition) {
      if (!best || (lg.waiverPosition as number) < (best.waiverPosition as number)) best = lg;
    }
    const avgPosition =
      withPosition.length > 0
        ? withPosition.reduce((sum, lg) => sum + (lg.waiverPosition ?? 0), 0) / withPosition.length
        : null;
    return { best, avgPosition, positionLeagues: withPosition.length };
  }, [leagues]);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bidOverride, setBidOverride] = useState<Record<string, number>>({});
  const [dropOverride, setDropOverride] = useState<Record<string, string | null>>({});
  const [execStatus, setExecStatus] = useState<Record<string, TaskStatus>>({});
  const [executing, setExecuting] = useState(false);
  const [execSummary, setExecSummary] = useState("");
  const execAbort = useRef({ aborted: false });
  const multiAddSettingsByLeague = useMemo(() => new Map(multiAddLeagues.map((l) => [l.league.id, l.league.settings])), [multiAddLeagues]);

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
  const remainingByLeague = useMemo(() => new Map(faabLeagues.map((l) => [l.leagueId, l.remaining])), [faabLeagues]);
  // Full roster lookup (starters/bench/reserve) for the "show roster"
  // toggle — separate from candidateLeagues, which only carries what the
  // add/drop flow itself needs.
  const leagueById = useMemo(() => new Map(leagues.map((lg) => [lg.leagueId, lg])), [leagues]);

  const candidateLeagues = useMemo(() => {
    if (!selectedId) return [];
    return leagues
      .filter((lg) => !lg.players.includes(selectedId))
      .map((lg) => {
        const settings = multiAddSettingsByLeague.get(lg.leagueId);
        const inner = settings && typeof settings === "object" ? (settings as Record<string, unknown>).settings : undefined;
        const s = inner && typeof inner === "object" ? (inner as Record<string, unknown>) : {};
        const faab = s.waiver_type === 2;
        const bidMin = typeof s.waiver_bid_min === "number" ? s.waiver_bid_min : 0;
        const pos = pmap?.[selectedId]?.p ?? "";
        const bid = Math.max(bidMin, suggestBid(faabStats, lg.leagueId, pos, bidMin, bidMin).bid);

        // Real roster math, same rule buildAddPlan uses elsewhere: only
        // propose a drop when the active roster (reserve/IR excluded) is
        // actually at its limit. rosterSize === 0 means roster settings
        // weren't synced — treated as "not full" rather than guessed.
        const active = lg.players.length - lg.reserve.length;
        const full = lg.rosterSize > 0 && active >= lg.rosterSize;
        // Every real rostered player is a choosable drop EXCEPT IR/reserve
        // (dropping one wouldn't free an active slot anyway, so offering it
        // would be misleading, not just unsafe) — a manual, per-league
        // override the owner explicitly asked to see more of. Bench players
        // sort first (weakest real season points first, so the safest pick
        // stays the default at index 0); starters are still offered, just
        // ranked after the bench and labelled, since dropping one is a
        // bigger call the owner should make deliberately, not by accident.
        const dropCandidates = lg.players
          .filter((id) => id !== selectedId && !lg.reserve.includes(id))
          .map((id) => ({
            playerId: id,
            value: seasonTotals?.[id]?.pts ?? null,
            isStarter: lg.starters.includes(id),
          }))
          .sort((a, b) => Number(a.isStarter) - Number(b.isStarter) || (a.value ?? Infinity) - (b.value ?? Infinity));

        return {
          leagueId: lg.leagueId,
          leagueName: lg.leagueName,
          rosterId: lg.rosterId,
          full,
          dropCandidates,
          // Real league-wide check, not just "not on my roster" — every
          // other team's roster in this league is real data now too (see
          // LeagueRoster in prisma/schema.prisma), so this is honest about
          // whether a claim could actually go through.
          takenByOther: lg.allRosteredPlayers.includes(selectedId),
          faab,
          bidMin,
          budgetLeft: faab ? remainingByLeague.get(lg.leagueId) ?? null : null,
          bid,
        };
      });
  }, [leagues, selectedId, seasonTotals, multiAddSettingsByLeague, faabStats, pmap, remainingByLeague]);

  // Reset selection to "every league where he's a true free agent" whenever
  // the target player changes — leagues where another team already has him
  // start unchecked (and disabled below), since sending those would be a
  // claim that can't go through.
  useEffect(() => {
    if (!selectedId) {
      setCheckedIds(new Set());
      setDropOverride({});
      return;
    }
    const ids = leagues
      .filter((lg) => !lg.players.includes(selectedId) && !lg.allRosteredPlayers.includes(selectedId))
      .map((lg) => lg.leagueId);
    setCheckedIds(new Set(ids));
    setDropOverride({});
    setExecStatus({});
    setExecSummary("");
  }, [selectedId, leagues]);

  const toggle = (leagueId: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
  };

  const dropFor = (c: (typeof candidateLeagues)[number]): string | null =>
    c.leagueId in dropOverride ? dropOverride[c.leagueId] : c.dropCandidates[0]?.playerId ?? null;
  // A full roster with nobody eligible to drop can't be run; an open-slot
  // league never needs a drop at all.
  const runnable = (c: (typeof candidateLeagues)[number]) => !c.full || !!dropFor(c);

  const bidFor = (c: (typeof candidateLeagues)[number]) => {
    const raw = c.leagueId in bidOverride ? bidOverride[c.leagueId] : c.bid;
    const capped = c.budgetLeft != null ? Math.min(raw, c.budgetLeft) : raw;
    return Math.max(c.bidMin, Math.trunc(capped));
  };

  const selectedCount = candidateLeagues.filter((c) => checkedIds.has(c.leagueId) && !c.takenByOther && runnable(c)).length;

  const runAdd = async () => {
    if (!multiAddToken || executing || selectedCount === 0 || !selectedId) return;
    setExecuting(true);
    setExecSummary("");
    execAbort.current = { aborted: false };
    const targets = candidateLeagues.filter((c) => checkedIds.has(c.leagueId) && !c.takenByOther && runnable(c));
    const doneLeagues: string[] = [];
    const tasks: BulkTask[] = targets.map((c) => ({
      key: c.leagueId,
      run: async () => {
        const drop = c.full ? dropFor(c) ?? undefined : undefined;
        try {
          await addDropFreeAgent(multiAddToken, { leagueId: c.leagueId, rosterId: c.rosterId, addPlayerId: selectedId, dropPlayerId: drop });
          doneLeagues.push(c.leagueId);
          return drop ? `added, dropped ${pmap?.[drop]?.n ?? drop}` : "added";
        } catch (e) {
          // A player still on waivers can't be a straight add — Sleeper says
          // so in its error text; fall back to a real waiver claim instead.
          if (e instanceof Error && /waiver/i.test(e.message)) {
            const bid = bidFor(c);
            await claimWaiver(multiAddToken, { leagueId: c.leagueId, rosterId: c.rosterId, addPlayerId: selectedId, dropPlayerId: drop, bid });
            doneLeagues.push(c.leagueId);
            return `waiver claim${c.faab ? ` $${bid}` : ""}`;
          }
          throw e;
        }
      },
    }));
    const result = await runBulk(tasks, {
      concurrency: 3,
      signal: execAbort.current,
      onStatus: (key, s) => setExecStatus((prev) => ({ ...prev, [key]: s })),
    });
    setExecuting(false);
    const refreshed = result.done > 0 ? await refreshLeagues(doneLeagues) : null;
    setExecSummary(
      `${result.done} sent${result.failed ? `, ${result.failed} failed` : ""}.${
        result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : ""
      }${refreshed === null ? "" : refreshed ? " Fantis's data was refreshed for those leagues." : ""}`
    );
  };

  return (
    <>
      <section className="sec" style={{ paddingBottom: 0 }}>
        <PageHead
          description={
            <>
              Every in-season league you&rsquo;re actually managing (best ball excluded) — every pending
              waiver claim, who&rsquo;s trending on Sleeper right now, adding several players at once, or
              one target&rsquo;s real per-league drop math and FAAB bid, right where you&rsquo;re claiming him.
            </>
          }
        />

        {!selectedId && waiverSummary.positionLeagues > 0 && (
          <StatCardGrid variant="hero">
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
        <SectionHead title="Single-player lookup" right="adds or claims him directly, no trip to Sleeper" />
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

          {!multiAddToken && (
            <p className="hint" style={{ color: "var(--dim)" }}>
              ○ Connect Sleeper write access above to add or claim directly.
            </p>
          )}

          {candidateLeagues.length === 0 ? (
            <p className="hint">Every league already has this player on your roster.</p>
          ) : (
            <>
              <DataTable>
                {candidateLeagues.map((c) => {
                  const { leagueId, leagueName, full, dropCandidates, takenByOther, faab, budgetLeft } = c;
                  const chosenDropId = full ? dropFor(c) : null;
                  const dropVal = chosenDropId ? seasonTotals?.[chosenDropId]?.pts ?? null : null;
                  const diff =
                    selectedSeasonPts != null && dropVal != null ? selectedSeasonPts - dropVal : null;
                  const status = execStatus[leagueId];
                  const done = status?.kind === "done";
                  const noBench = full && dropCandidates.length === 0;
                  const leagueClaims = claimsByLeague.get(leagueId) ?? [];
                  const claimsOpen = expandedClaimLeagues.has(leagueId);
                  const lg = leagueById.get(leagueId);
                  const rosterOpen = expandedRosterLeagues.has(leagueId);
                  return (
                    <div key={leagueId}>
                      <TableRow
                        as="label"
                        style={{ cursor: takenByOther || noBench || done ? "default" : "pointer", opacity: takenByOther || noBench ? 0.55 : 1 }}
                      >
                        <input
                          type="checkbox"
                          checked={checkedIds.has(leagueId) && runnable(c)}
                          disabled={takenByOther || noBench || done}
                          onChange={() => toggle(leagueId)}
                        />
                        <span className="tname" style={{ flex: 1 }}>
                          {leagueName}
                        </span>
                        {lg && (
                          <button
                            type="button"
                            className="link"
                            style={{ fontSize: 11 }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleRosterExpanded(leagueId);
                            }}
                          >
                            roster {rosterOpen ? "▲" : "▼"}
                          </button>
                        )}
                        {!claimsScanned ? (
                          <span className="portmeta" style={{ fontSize: 11 }}>scan claims above</span>
                        ) : leagueClaims.length === 0 ? (
                          <span className="portmeta" style={{ fontSize: 11 }}>no pending claims</span>
                        ) : (
                          <button
                            type="button"
                            className="link"
                            style={{ fontSize: 11, color: "var(--amber)" }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleClaimsExpanded(leagueId);
                            }}
                          >
                            {leagueClaims.length} pending {claimsOpen ? "▲ hide" : "▼ show"}
                          </button>
                        )}
                        {takenByOther ? (
                          <span className="portmeta" style={{ color: "var(--red)" }}>
                            already rostered by another team in this league
                          </span>
                        ) : !full ? (
                          <span className="portmeta" style={{ color: "var(--mint)" }}>open roster spot — no drop needed</span>
                        ) : noBench ? (
                          <span className="portmeta" style={{ color: "var(--red)" }}>
                            roster full, nobody eligible to drop
                          </span>
                        ) : (
                          <select
                            className="select sm"
                            value={chosenDropId ?? ""}
                            onClick={(e) => e.preventDefault()}
                            onChange={(e) => setDropOverride((prev) => ({ ...prev, [leagueId]: e.target.value || null }))}
                          >
                            {dropCandidates.map((d) => (
                              <option key={d.playerId} value={d.playerId}>
                                drop {pmap?.[d.playerId]?.n ?? d.playerId}
                                {d.value != null ? ` (${Math.round(d.value)} pts)` : ""}
                                {d.isStarter ? " — starting" : ""}
                              </option>
                            ))}
                          </select>
                        )}
                        {!takenByOther && full && <Diff value={diff} />}
                        {!takenByOther && faab && (
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <input
                              className="input"
                              type="number"
                              min={c.bidMin}
                              max={budgetLeft ?? undefined}
                              value={bidFor(c)}
                              onClick={(e) => e.preventDefault()}
                              onChange={(e) =>
                                setBidOverride((prev) => ({ ...prev, [leagueId]: Number(e.target.value) }))
                              }
                              style={{ width: 64, flex: "none", textAlign: "center" }}
                            />
                            {budgetLeft != null && (
                              <span
                                className="portmeta"
                                style={{ fontSize: 11, color: budgetLeft < c.bidMin ? "var(--red)" : undefined }}
                              >
                                ${budgetLeft} left
                              </span>
                            )}
                          </div>
                        )}
                        {!takenByOther && <StatusCell status={status} />}
                      </TableRow>

                      {claimsOpen && leagueClaims.length > 0 && (
                        <TableRow as="static" style={{ background: "var(--line-soft)" }}>
                          <span style={{ flex: "0 0 22px" }} />
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, fontSize: 12, padding: "4px 0" }}>
                            {leagueClaims.map((cl) => {
                              const add = cl.addId ? pmap?.[cl.addId]?.n ?? cl.addId : "?";
                              const addPos = cl.addId ? pmap?.[cl.addId]?.p : undefined;
                              const drop = cl.dropId ? pmap?.[cl.dropId]?.n ?? cl.dropId : null;
                              return (
                                <div key={cl.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  {addPos && (
                                    <span className="pos" style={posChipStyle(addPos)}>
                                      {addPos}
                                    </span>
                                  )}
                                  <span className="tname">{add}</span>
                                  {drop && <span className="portmeta">drop {drop}</span>}
                                  {cl.bid != null && <span className="portmeta">${cl.bid} bid</span>}
                                  <span className="portmeta" style={{ fontStyle: "italic" }}>{cl.status}</span>
                                </div>
                              );
                            })}
                          </div>
                        </TableRow>
                      )}

                      {rosterOpen && lg && (
                        <TableRow as="static" style={{ background: "var(--line-soft)" }}>
                          <span style={{ flex: "0 0 22px" }} />
                          <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 18, fontSize: 12, padding: "4px 0" }}>
                            {(
                              [
                                ["Starters", lg.starters],
                                ["Bench", lg.players.filter((id) => !lg.starters.includes(id) && !lg.reserve.includes(id))],
                                ["IR / Reserve", lg.reserve],
                              ] as const
                            ).map(([label, ids]) => (
                              <div key={label} style={{ minWidth: 150 }}>
                                <div className="portmeta" style={{ fontWeight: 600, marginBottom: 2 }}>
                                  {label} ({ids.length})
                                </div>
                                {ids.length === 0 ? (
                                  <span className="portmeta">—</span>
                                ) : (
                                  ids.map((id) => (
                                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                                      {pmap?.[id]?.p && (
                                        <span className="pos" style={posChipStyle(pmap[id].p)}>
                                          {pmap[id].p}
                                        </span>
                                      )}
                                      <span className="tname">{pmap?.[id]?.n ?? id}</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            ))}
                          </div>
                        </TableRow>
                      )}
                    </div>
                  );
                })}
              </DataTable>

              <p className="hint" style={{ marginTop: 10 }}>
                Leagues where another team already has him, or where the roster&rsquo;s full with nobody
                eligible to drop, are shown greyed out and can&rsquo;t be selected — real checks against
                that league&rsquo;s actual roster, not a guess. A league with an open active-roster spot
                (reserve/IR excluded) never proposes a drop at all. Where a drop is genuinely needed, the
                dropdown lists every real rostered player except IR/reserve (dropping one of those wouldn&rsquo;t
                free an active slot anyway) — bench players first, ranked weakest real season-projected
                points first so the default stays the safe pick, with starters offered further down and
                labelled &ldquo;starting&rdquo; so dropping one is always a deliberate choice. Pick any
                option any time and the Diff column updates to match. The small line next to each league
                name shows real pending waiver claims already sitting in that league (from the scan above)
                so you can weigh this add against what&rsquo;s already in flight there. If a league needs a
                waiver claim instead of an instant add (Sleeper decides that, not Fantis), the suggested bid
                comes from this account&rsquo;s own real past winning bids when there&rsquo;s history, or
                the league&rsquo;s own minimum otherwise — editable per row.
              </p>

              <button
                className="btn"
                style={{ marginTop: 10 }}
                onClick={runAdd}
                disabled={!multiAddToken || executing || selectedCount === 0}
              >
                {executing ? "Sending…" : `Add/claim in ${selectedCount} selected league${selectedCount === 1 ? "" : "s"}`}
              </button>
              {execSummary && <p className="hint" style={{ marginTop: 8 }}>{execSummary}</p>}
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
