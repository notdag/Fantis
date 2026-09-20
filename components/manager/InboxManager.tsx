"use client";

import { useMemo, useRef, useState } from "react";
import { classifyTransactions, type Claim, type Trade, type TradeSide } from "@/lib/inbox";
import { runBulk, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import {
  acceptTrade,
  rejectTrade,
  cancelTrade,
  cancelWaiverClaim,
  fetchLeagueTransactions,
} from "@/lib/sleeperWrite";
import { isBestBall } from "@/lib/manager";
import { posChipStyle } from "@/lib/players";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { useTradeValues } from "@/lib/useTradeValues";
import { useFantasyCalcValues, fantasyCalcValue } from "@/lib/fantasyCalc";
import type { PlayerMap } from "@/lib/types";
import ConnectWriteAccess from "./ConnectWriteAccess";
import { PlayerAvatar } from "./Avatar";
import { SectionHead } from "./PageHead";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";

export interface InboxLeague {
  id: string;
  name: string;
  status: string;
  settings: unknown; // slimmed — enough for best-ball detection
  rosterId: number; // my roster in this league
  teams: Record<number, string | null>; // rosterId -> team name
}

type Tab = "incoming" | "outgoing" | "claims";
type Action =
  | { kind: "accept" | "reject" | "cancelTrade"; items: Trade[] }
  | { kind: "cancelClaim"; items: Claim[] };

const ACTION_LABEL: Record<Action["kind"], string> = {
  accept: "Accept",
  reject: "Decline",
  cancelTrade: "Cancel offer",
  cancelClaim: "Cancel claim",
};

export default function InboxManager({ leagues }: { leagues: InboxLeague[] }) {
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("incoming");
  const { pmap } = usePlayerMap();
  const tradeValues = useTradeValues();
  const fcValues = useFantasyCalcValues();

  const eligible = useMemo(
    () => leagues.filter((l) => l.status === "in_season" && !isBestBall(l.settings)),
    [leagues]
  );
  const leagueById = useMemo(() => new Map(leagues.map((l) => [l.id, l])), [leagues]);

  const [trades, setTrades] = useState<Trade[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, failed: 0 });
  const [scanErrors, setScanErrors] = useState<string[]>([]);
  const [waiverStatuses, setWaiverStatuses] = useState<Record<string, number>>({});
  const scanAbort = useRef({ aborted: false });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action | null>(null);
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const runAbort = useRef({ aborted: false });

  const runScan = async () => {
    if (!token) return;
    setScanning(true);
    setScanned(false);
    setTrades([]);
    setClaims([]);
    setScanErrors([]);
    setWaiverStatuses({});
    setProgress({ done: 0, failed: 0 });
    setSelected(new Set());
    setStatus({});
    setSummary("");
    scanAbort.current = { aborted: false };

    const accTrades: Trade[] = [];
    const accClaims: Claim[] = [];
    const statusCounts: Record<string, number> = {};
    const tasks: BulkTask[] = eligible.map((lg) => ({
      key: lg.id,
      run: async () => {
        const raw = await fetchLeagueTransactions(token, { leagueId: lg.id, rosterId: lg.rosterId });
        for (const w of raw.waivers) statusCounts[w.status] = (statusCounts[w.status] ?? 0) + 1;
        const c = classifyTransactions(lg.id, lg.rosterId, raw);
        accTrades.push(...c.trades);
        accClaims.push(...c.claims);
      },
    }));

    const result = await runBulk(tasks, {
      concurrency: 5,
      gapMs: 50,
      signal: scanAbort.current,
      onStatus: (key, s) => {
        if (s.kind === "done") {
          setProgress((p) => ({ ...p, done: p.done + 1 }));
          setTrades([...accTrades]);
          setClaims([...accClaims]);
          setWaiverStatuses({ ...statusCounts });
        } else if (s.kind === "failed") {
          setProgress((p) => ({ done: p.done + 1, failed: p.failed + 1 }));
          const name = leagueById.get(key)?.name ?? key;
          setScanErrors((prev) => (prev.length < 20 ? [...prev, `${name}: ${s.message}`] : prev));
        }
      },
    });
    setTrades([...accTrades]);
    setClaims([...accClaims]);
    setWaiverStatuses({ ...statusCounts });
    setScanning(false);
    setScanned(true);
    if (result.stoppedForAuth) setScanErrors((p) => ["Stopped early — Sleeper rejected the login token; reconnect above.", ...p]);
  };

  const finished = (key: string) => status[key]?.kind === "done";
  const incoming = trades.filter((t) => t.direction === "incoming" && !finished(t.key));
  const outgoing = trades.filter((t) => t.direction === "outgoing" && !finished(t.key));
  const openClaims = claims.filter((c) => !finished(c.key));

  const name = (id: string | null) => (id ? pmap?.[id]?.n ?? id : "—");
  const leagueName = (id: string) => leagueById.get(id)?.name ?? id;
  const teamName = (t: Trade) => {
    const lg = leagueById.get(t.leagueId);
    return t.otherRosterIds.map((r) => lg?.teams[r] || `Team ${r}`).join(" & ");
  };

  // Two labelled values per side (Fantis's own curated value and
  // FantasyCalc's) — shown side by side, never blended. Picks and FAAB aren't
  // valued by either source, so they're listed as text only.
  const sideValue = (side: TradeSide) => {
    let fantis = 0;
    let fc = 0;
    for (const id of side.players) {
      const e = pmap?.[id];
      if (!e) continue;
      fantis += tradeValues[e.n]?.value ?? 0;
      fc += fcValues ? fantasyCalcValue(fcValues, { name: e.n, pos: e.p }) : 0;
    }
    return { fantis, fc };
  };
  const diff = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}`;

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const describe = (a: Action): string[] =>
    a.kind === "cancelClaim"
      ? a.items.map((c) => `${leagueName(c.leagueId)}: ${name(c.addId)}${c.dropId ? ` (drop ${name(c.dropId)})` : ""}${c.bid != null ? ` · $${c.bid}` : ""}`)
      : a.items.map((t) => `${leagueName(t.leagueId)} · ${teamName(t)}: give ${sideText(t.give)} / get ${sideText(t.get)}`);

  function sideText(side: TradeSide): string {
    const parts = [...side.players.map((id) => name(id)), ...side.picks, ...side.faab];
    return parts.length ? parts.join(", ") : "nothing";
  }

  const confirmAction = async () => {
    if (!token || !action) return;
    const a = action;
    setAction(null);
    setRunning(true);
    setSummary("");
    runAbort.current = { aborted: false };
    const tasks: BulkTask[] = a.items.map((item) => ({
      key: item.key,
      run: async () => {
        const params = { leagueId: item.leagueId, transactionId: item.transactionId, leg: item.leg };
        if (a.kind === "accept") await acceptTrade(token, params);
        else if (a.kind === "reject") await rejectTrade(token, params);
        else if (a.kind === "cancelTrade") await cancelTrade(token, params);
        else await cancelWaiverClaim(token, params);
      },
    }));
    const result = await runBulk(tasks, {
      // A single accept is deliberately one-at-a-time.
      concurrency: a.kind === "accept" ? 1 : 3,
      signal: runAbort.current,
      onStatus: (key, s) => setStatus((prev) => ({ ...prev, [key]: s })),
    });
    setRunning(false);
    setSelected(new Set());
    setSummary(
      `${ACTION_LABEL[a.kind]}: ${result.done} done${result.failed ? `, ${result.failed} failed` : ""}${
        result.skipped ? `, ${result.skipped} skipped` : ""
      }.${result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : ""}`
    );
  };

  const players = (side: TradeSide, pm: PlayerMap | null) => (
    <>
      {side.players.map((id) => (
        <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 12 }}>
          <PlayerAvatar playerId={id} pos={pm?.[id]?.p} size={22} />
          <span className="tname">{name(id)}</span>
          {pm?.[id]?.p && <span className="pos" style={posChipStyle(pm[id].p)}>{pm[id].p}</span>}
        </span>
      ))}
      {[...side.picks, ...side.faab].map((t, i) => (
        <span key={i} className="portmeta" style={{ marginRight: 12 }}>{t}</span>
      ))}
      {side.players.length + side.picks.length + side.faab.length === 0 && <span className="portmeta">nothing</span>}
    </>
  );

  const tradeCard = (t: Trade, opts: { primary: "accept" | "cancel" }) => {
    const g = sideValue(t.give);
    const r = sideValue(t.get);
    return (
      <div key={t.key} className="mgrbreakdowncard" style={{ padding: 14, opacity: finished(t.key) ? 0.6 : 1 }}>
        <div className="field" style={{ alignItems: "center", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={selected.has(t.key)}
            disabled={running}
            onChange={() => toggle(t.key)}
            aria-label="Select"
          />
          <strong style={{ flex: 1, fontSize: 13 }}>
            {leagueName(t.leagueId)} <span className="portmeta">· {opts.primary === "accept" ? "from" : "to"} {teamName(t)}</span>
          </strong>
          <StatusCell status={status[t.key]} />
        </div>
        <div style={{ marginBottom: 6 }}>
          <span className="portmeta" style={{ display: "inline-block", minWidth: 64 }}>You give</span>
          {players(t.give, pmap)}
        </div>
        <div style={{ marginBottom: 8 }}>
          <span className="portmeta" style={{ display: "inline-block", minWidth: 64 }}>You get</span>
          {players(t.get, pmap)}
        </div>
        <div className="portmeta" style={{ marginBottom: 8 }}>
          Fantis value: give {Math.round(g.fantis)} · get {Math.round(r.fantis)} ({diff(r.fantis - g.fantis)}) &nbsp;|&nbsp;
          FantasyCalc: give {Math.round(g.fc)} · get {Math.round(r.fc)} ({diff(r.fc - g.fc)}) &nbsp;|&nbsp; picks/FAAB not valued
        </div>
        <div className="field">
          {opts.primary === "accept" ? (
            <>
              <button className="btn sm" disabled={!token || running} onClick={() => setAction({ kind: "accept", items: [t] })}>Accept</button>
              <button className="btn ghost sm" disabled={!token || running} onClick={() => setAction({ kind: "reject", items: [t] })}>Decline</button>
            </>
          ) : (
            <button className="btn ghost sm" disabled={!token || running} onClick={() => setAction({ kind: "cancelTrade", items: [t] })}>Cancel offer</button>
          )}
          <span className="portmeta" style={{ marginLeft: "auto" }} title="Sleeper's raw status, kept for calibration">status: {t.status}</span>
        </div>
      </div>
    );
  };

  const selectedTrades = (list: Trade[]) => list.filter((t) => selected.has(t.key));
  const selectedClaims = openClaims.filter((c) => selected.has(c.key));

  if (leagues.length === 0) return <p className="hint">No synced leagues yet.</p>;

  return (
    <>
      <section className="sec">
        <SectionHead title="Trades & Claims" right="pending offers and waiver claims across every league" />
        <ConnectWriteAccess onTokenReady={setToken} />

        <StatCardGrid variant="grid">
          <StatCard label="Offers to me" value={scanned ? incoming.length : "—"} valueColor={incoming.length > 0 ? "var(--amber)" : undefined} />
          <StatCard label="My offers out" value={scanned ? outgoing.length : "—"} />
          <StatCard label="Claims pending" value={scanned ? openClaims.length : "—"} />
          <StatCard label="Leagues scanned" value={scanning || scanned ? `${progress.done}/${eligible.length}` : `0/${eligible.length}`} />
        </StatCardGrid>

        <div className="field" style={{ margin: "12px 0", alignItems: "center" }}>
          {scanning ? (
            <button className="btn ghost" onClick={() => (scanAbort.current.aborted = true)}>Abort scan</button>
          ) : (
            <button className="btn" disabled={!token || eligible.length === 0} onClick={runScan}>
              {scanned ? "Rescan" : `Scan ${eligible.length} leagues`}
            </button>
          )}
          <span className="hint" style={{ margin: 0 }}>
            Reads Sleeper directly from your browser (in-season, non-best-ball leagues). Nothing is
            checked in the background — scan when you want a fresh look.
          </span>
        </div>
        {!token && <p className="hint" style={{ color: "var(--red)" }}>Connect write access above first.</p>}
        {scanErrors.length > 0 && (
          <div className="err">
            {scanErrors.slice(0, 5).map((e, i) => (
              <div key={i}>{e}</div>
            ))}
            {scanErrors.length > 5 && <div>…and {scanErrors.length - 5} more league errors</div>}
          </div>
        )}
        {scanned && Object.keys(waiverStatuses).length > 0 && (
          <p className="portmeta" style={{ margin: "4px 0" }}>
            Waiver statuses Sleeper returned: {Object.entries(waiverStatuses).map(([s, n]) => `${s} ×${n}`).join(", ")}
          </p>
        )}
        {summary && <p className="hint" style={{ color: "var(--bone)" }}>{summary}</p>}

        <div className="field" style={{ margin: "12px 0" }}>
          <button className={`chip-filter ${tab === "incoming" ? "on" : ""}`} onClick={() => setTab("incoming")}>Offers to me{scanned ? ` (${incoming.length})` : ""}</button>
          <button className={`chip-filter ${tab === "outgoing" ? "on" : ""}`} onClick={() => setTab("outgoing")}>My offers{scanned ? ` (${outgoing.length})` : ""}</button>
          <button className={`chip-filter ${tab === "claims" ? "on" : ""}`} onClick={() => setTab("claims")}>Pending claims{scanned ? ` (${openClaims.length})` : ""}</button>
        </div>

        {action && (
          <BulkConfirm
            title={`${ACTION_LABEL[action.kind]}: ${action.items.length} ${action.kind === "cancelClaim" ? "claim" : "trade"}${action.items.length === 1 ? "" : "s"}`}
            lines={describe(action)}
            confirmLabel={`${ACTION_LABEL[action.kind]} on Sleeper`}
            onConfirm={confirmAction}
            onCancel={() => setAction(null)}
          />
        )}

        {!scanned && !scanning && <p className="hint">Run a scan to load your pending offers and claims.</p>}

        {scanned && tab === "incoming" && (
          <>
            {incoming.length === 0 ? (
              <p className="hint">No pending offers waiting on you.</p>
            ) : (
              <>
                <div className="field" style={{ marginBottom: 8 }}>
                  <button
                    className="btn ghost sm"
                    disabled={!token || running || selectedTrades(incoming).length === 0}
                    onClick={() => setAction({ kind: "reject", items: selectedTrades(incoming) })}
                  >
                    Decline selected ({selectedTrades(incoming).length})
                  </button>
                  <span className="portmeta">Accepting is always one trade at a time.</span>
                </div>
                <div style={{ display: "grid", gap: 10 }}>{incoming.map((t) => tradeCard(t, { primary: "accept" }))}</div>
              </>
            )}
          </>
        )}

        {scanned && tab === "outgoing" && (
          <>
            {outgoing.length === 0 ? (
              <p className="hint">You have no offers out.</p>
            ) : (
              <>
                <div className="field" style={{ marginBottom: 8 }}>
                  <button
                    className="btn ghost sm"
                    disabled={!token || running || selectedTrades(outgoing).length === 0}
                    onClick={() => setAction({ kind: "cancelTrade", items: selectedTrades(outgoing) })}
                  >
                    Cancel selected ({selectedTrades(outgoing).length})
                  </button>
                </div>
                <div style={{ display: "grid", gap: 10 }}>{outgoing.map((t) => tradeCard(t, { primary: "cancel" }))}</div>
              </>
            )}
          </>
        )}

        {scanned && tab === "claims" && (
          <>
            {openClaims.length === 0 ? (
              <p className="hint">No pending waiver claims.</p>
            ) : (
              <>
                <div className="field" style={{ marginBottom: 8 }}>
                  <button
                    className="btn ghost sm"
                    disabled={!token || running || selectedClaims.length === 0}
                    onClick={() => setAction({ kind: "cancelClaim", items: selectedClaims })}
                  >
                    Cancel selected ({selectedClaims.length})
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
                      <input type="checkbox" checked={selected.has(c.key)} disabled={running} onChange={() => toggle(c.key)} />
                      <span className="tname" style={{ flex: 1 }}>
                        {name(c.addId)}
                        {c.dropId && <span className="portmeta" style={{ fontWeight: 400 }}> · drop {name(c.dropId)}</span>}
                        <span className="portmeta" style={{ display: "block", fontWeight: 400 }}>{leagueName(c.leagueId)}</span>
                      </span>
                      <span className="portmeta" style={{ minWidth: 60 }}>{c.bid != null ? `$${c.bid}` : "—"}</span>
                      <span className="portmeta" style={{ minWidth: 110 }} title="Sleeper's raw status">{c.status}</span>
                      <StatusCell status={status[c.key]} />
                    </TableRow>
                  ))}
                </DataTable>
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}
