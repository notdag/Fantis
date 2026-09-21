"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRosters, getState, getTransactions } from "@/lib/sleeper";
import { getWeekGameStates } from "@/lib/espnGames";
import { addDropFreeAgent, claimWaiver, fetchLeagueTransactions, moveToIR, setStarters, SleeperGraphQLError } from "@/lib/sleeperWrite";
import { getStoredToken } from "@/lib/sleeperToken";
import { isAuthError, runBulk, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { fetchSnapshot, type RawRoster, type RawTxn } from "@/lib/commandCenter/classify";
import {
  KIND_LABEL,
  canAutoExecute,
  canExecuteApproved,
  describeProposal,
  selectAutoIrMoves,
  type Proposal,
  type ProposalStatus,
} from "@/lib/commandCenter/proposals";
import type { CcLeague } from "@/lib/commandCenter/types";
import { executeProposal, type ExecDeps, type ExecMode, type ExecResult, type ExecWriters } from "@/lib/commandCenterExec";
import { BulkConfirm } from "./BulkConfirm";
import { useRefreshLeagues } from "./useRefreshLeagues";
import { readAutoConfig, readAutoDay, readPermission, useAutoConfig, useAutoDay, useBulkEnabled, usePermission, writeAutoConfig, writeAutoDay, writeBulkEnabled } from "./ccStore";

const BULK_CAP = 25;

const STATUS_LABEL: Record<ProposalStatus, string> = {
  proposed: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  executing: "Running…",
  executed: "Done · verified",
  submitted: "Claim pending",
  failed: "Failed",
  verify_failed: "Sent · unverified",
};

const WRITERS: ExecWriters = {
  addDropFreeAgent,
  claimWaiver,
  moveToIR,
  setStarters,
  fetchLeagueTransactions: async (token, p) => {
    const r = await fetchLeagueTransactions(token, p);
    return { trades: r.trades, waivers: r.waivers as unknown as { status: string; adds?: Record<string, number> | null; roster_ids?: number[] | null }[] };
  },
};

type Filter = "review" | "approved" | "history";

export default function ProposalsPanel({ leagues, version }: { leagues: CcLeague[]; version: number }) {
  const permission = usePermission();
  const bulkEnabled = useBulkEnabled();
  const auto = useAutoConfig();
  const autoDay = useAutoDay();
  const { pmap } = usePlayerMap();
  const refresh = useRefreshLeagues();

  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("review");
  const [notes, setNotes] = useState<Record<string, string>>({}); // per-proposal outcome / error
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  // A coarse clock (for "running too long" hints) that avoids reading Date.now() during render.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const [season, setSeason] = useState<string | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [leg, setLeg] = useState(1);
  useEffect(() => {
    getState()
      .then((s) => {
        setSeason(s.season);
        setWeek(Math.max(1, s.week || 1));
        setLeg(s.leg || s.week || 1);
      })
      .catch(() => undefined);
  }, []);

  const leagueById = useMemo(() => new Map(leagues.map((l) => [l.id, l])), [leagues]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/manager/proposals");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't load proposals.");
      setProposals(body.proposals as Proposal[]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load proposals.");
    }
  }, []);
  // Initial load and reload whenever chat saves new proposals.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/manager/proposals")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Couldn't load proposals.");
        if (!cancelled) {
          setProposals(body.proposals as Proposal[]);
          setError("");
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load proposals."));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const patch = async (id: string, body: Record<string, unknown>): Promise<string | null> => {
    try {
      const res = await fetch(`/api/manager/proposals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const b = await res.json().catch(() => ({}));
      return res.ok ? null : b.error || "The server refused that change.";
    } catch {
      return "Couldn't reach the server.";
    }
  };

  const setBusyFor = (id: string, on: boolean) =>
    setBusy((prev) => {
      const n = new Set(prev);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  // ---- dependencies for the executor (fresh reads every time)
  const makeDeps = useCallback(
    async (mode: ExecMode): Promise<ExecDeps> => {
      const states = season && week ? await getWeekGameStates(season, week).catch(() => null) : null;
      return {
        permission: readPermission(),
        mode,
        bulkEnabled,
        autoRuleEnabled: readAutoConfig().enabled && readAutoConfig().irMove,
        token: getStoredToken(),
        league: (id) => leagueById.get(id) ?? null,
        readSnapshot: (lg) =>
          fetchSnapshot(lg, { getRosters: (id) => getRosters(id) as unknown as Promise<RawRoster[]>, getTransactions: (id, l) => getTransactions(id, l) as unknown as Promise<RawTxn[]> }, Date.now(), leg, false),
        injuryOf: (id) => pmap?.[id]?.inj ?? null,
        // Unknown game status is treated as "started" — the safe direction.
        isLocked: (id) => {
          if (!states) return true;
          const team = pmap?.[id]?.t;
          const g = team ? states[team] : undefined;
          return !!g && g.state !== "pre";
        },
        writers: WRITERS,
        isAuthError,
      };
    },
    [season, week, leg, pmap, leagueById, bulkEnabled]
  );

  // The single path that changes a proposal's status around an execution. Returns the result.
  const execAndRecord = useCallback(
    async (p: Proposal, mode: ExecMode): Promise<ExecResult> => {
      const startErr = await patch(p.id, { status: "executing", message: mode === "auto" ? "Started by the auto rule" : mode === "bulk" ? "Started in a bulk run you confirmed" : "Started by you" });
      if (startErr) return { status: "failed", message: `Not sent — ${startErr}`, sent: false };
      const deps = await makeDeps(mode);
      let result: ExecResult;
      try {
        result = await executeProposal(p, deps);
      } catch (e) {
        result = { status: "failed", message: e instanceof Error ? e.message : "Unexpected error", sent: false };
      }
      // Never leave a proposal stuck in "executing": record whatever happened.
      const endStatus: ProposalStatus = result.status === "executing" ? "failed" : result.status;
      const endErr = await patch(p.id, { status: endStatus, message: result.message });
      if (endErr) result = { ...result, message: `${result.message} (couldn't record this on the server: ${endErr})` };
      if (result.sent) void refresh([p.leagueId]);
      return result;
    },
    [makeDeps, refresh]
  );

  const runOne = async (p: Proposal) => {
    setBusyFor(p.id, true);
    setConfirmId(null);
    const r = await execAndRecord(p, "individual");
    setNotes((n) => ({ ...n, [p.id]: r.message }));
    setBusyFor(p.id, false);
    await load();
  };

  const act = async (p: Proposal, status: ProposalStatus, message: string) => {
    setBusyFor(p.id, true);
    const err = await patch(p.id, { status, message });
    if (err) setNotes((n) => ({ ...n, [p.id]: err }));
    setBusyFor(p.id, false);
    await load();
  };

  const setBid = async (p: Proposal, bid: number) => {
    const err = await patch(p.id, { bid });
    if (err) setNotes((n) => ({ ...n, [p.id]: err }));
    await load();
  };

  // ---- bulk (Phase 4) — its own switch, one confirmation, sequential, stops on the first problem
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkAck, setBulkAck] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<Record<string, TaskStatus>>({});
  const [bulkSummary, setBulkSummary] = useState("");
  const bulkAbort = useRef({ aborted: false });

  const startBulk = async (list: Proposal[]) => {
    setBulkConfirm(false);
    setBulkAck(false);
    setBulkRunning(true);
    setBulkSummary("");
    bulkAbort.current = { aborted: false };
    const tasks: BulkTask[] = list.map((p) => ({
      key: p.id,
      run: async () => {
        const r = await execAndRecord(p, "bulk");
        setNotes((n) => ({ ...n, [p.id]: r.message }));
        if (r.authError) throw new SleeperGraphQLError([{ code: "unauthorized", message: r.message }]);
        if (r.status === "verify_failed") {
          bulkAbort.current.aborted = true; // unknown state on a real league — stop and let a human look
          throw new Error(r.message);
        }
        if (r.status !== "executed" && r.status !== "submitted") throw new Error(r.message);
        return r.message;
      },
    }));
    const result = await runBulk(tasks, {
      concurrency: 1,
      gapMs: 400,
      signal: bulkAbort.current,
      onStatus: (key, s) => setBulkStatus((prev) => ({ ...prev, [key]: s })),
    });
    setBulkRunning(false);
    setSelected(new Set());
    setBulkSummary(`${result.done} succeeded${result.failed ? `, ${result.failed} failed` : ""}${result.skipped ? `, ${result.skipped} not run` : ""}.${result.stoppedForAuth ? " Stopped: Sleeper rejected the login token." : ""}`);
    await load();
  };

  // ---- auto rules (Phase 5) — one narrow rule, timer while this page is open, caps, stops at the first problem
  const [autoRunning, setAutoRunning] = useState(false);
  const [dry, setDry] = useState<string[] | null>(null);
  const autoBusy = useRef(false);

  const eligibleLeagues = useMemo(() => leagues.filter((l) => l.status === "in_season" && !l.bestBall), [leagues]);

  const autoCycle = useCallback(
    async (dryRun: boolean) => {
      const cfg = readAutoConfig();
      if (readPermission() !== "AUTO_EXECUTE" || !cfg.enabled || !cfg.irMove || !pmap) return;
      if (autoBusy.current) return;
      autoBusy.current = true;
      setAutoRunning(true);
      const record = (message: string, executedDelta = 0) => {
        const day = readAutoDay();
        writeAutoDay({ ...day, executed: day.executed + executedDelta, lastRunAt: Date.now(), lastMessage: message });
      };
      const stopAuto = (why: string) => {
        writeAutoConfig({ ...readAutoConfig(), enabled: false });
        record(`Auto-execution switched itself OFF: ${why}`);
      };
      try {
        if (!getStoredToken()) return record("Skipped: Sleeper access isn't connected.");
        const remaining = cfg.maxPerDay - readAutoDay().executed;
        if (remaining <= 0) return record(`Skipped: today's cap of ${cfg.maxPerDay} auto actions is used up.`);
        const budget = Math.min(cfg.maxPerRun, remaining);

        // fresh read of every eligible league
        const snaps: Awaited<ReturnType<typeof fetchSnapshot>>[] = new Array(eligibleLeagues.length);
        let next = 0;
        const worker = async () => {
          while (next < eligibleLeagues.length) {
            const i = next++;
            snaps[i] = await fetchSnapshot(eligibleLeagues[i], { getRosters: (id) => getRosters(id) as unknown as Promise<RawRoster[]>, getTransactions: async () => [] }, Date.now(), leg, false);
          }
        };
        await Promise.all(Array.from({ length: 6 }, worker));

        const drafts = selectAutoIrMoves(snaps, (id) => pmap[id]?.inj ?? null, (id) => pmap[id]?.n ?? id, budget);
        if (dryRun) {
          setDry(drafts.map((d) => `${d.leagueName}: ${describeProposal(d)}`));
          return;
        }
        if (drafts.length === 0) return record("Checked every league: nothing matches the IR/PUP rule.");

        const res = await fetch("/api/manager/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drafts }) });
        if (!res.ok) return stopAuto("couldn't record proposals on the server");
        const list = await (await fetch("/api/manager/proposals")).json().catch(() => null);
        const mine = ((list?.proposals ?? []) as Proposal[]).filter((p) => p.origin === "auto" && p.status === "approved").slice(0, budget);
        setProposals(list?.proposals ?? null);

        let ok = 0;
        for (const p of mine) {
          const r = await execAndRecord(p, "auto");
          setNotes((n) => ({ ...n, [p.id]: r.message }));
          if (r.status === "executed") {
            ok++;
            continue;
          }
          // Anything other than a verified success ends the run AND turns auto off.
          record(`${ok} done, then stopped at ${p.leagueName}: ${r.message}`, ok);
          return stopAuto(r.authError ? "Sleeper rejected the login token" : `${p.leagueName}: ${r.status}`);
        }
        record(`Moved ${ok} player${ok === 1 ? "" : "s"} to IR (verified).`, ok);
      } finally {
        autoBusy.current = false;
        setAutoRunning(false);
        void load();
      }
    },
    [pmap, eligibleLeagues, leg, execAndRecord, load]
  );

  useEffect(() => {
    if (permission !== "AUTO_EXECUTE" || !auto.enabled || !auto.irMove) return;
    const id = window.setInterval(() => void autoCycle(false), auto.intervalMin * 60_000);
    return () => window.clearInterval(id);
  }, [permission, auto.enabled, auto.irMove, auto.intervalMin, autoCycle]);

  // ---- derived lists
  const list = proposals ?? [];
  const review = list.filter((p) => p.status === "proposed");
  const approved = list.filter((p) => p.status === "approved" || p.status === "executing");
  const history = list.filter((p) => !["proposed", "approved", "executing"].includes(p.status));
  const shown = filter === "review" ? review : filter === "approved" ? approved : history;
  const hasToken = typeof window !== "undefined" && !!getStoredToken();
  const canExec = canExecuteApproved(permission);
  const selectedList = approved.filter((p) => selected.has(p.id) && p.status === "approved");

  return (
    <div className="ccprops">
      {error && <div className="err">{error}</div>}
      <div className="cccounts">
        {(
          [
            ["review", `Needs review ${review.length}`],
            ["approved", `Approved ${approved.length}`],
            ["history", `History ${history.length}`],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <button key={k} className={`chip-filter ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
        <button className="ccexample" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {permission === "READ_ONLY" && <p className="hint" style={{ color: "var(--amber)" }}>Read-only mode: proposals from earlier are listed but nothing can be saved or approved. Switch to Propose only above.</p>}
      {canExec && !hasToken && <p className="hint" style={{ color: "var(--red)" }}>Sleeper access isn&rsquo;t connected in this browser, so nothing can be sent. Connect it on the Lineups page.</p>}

      {/* Phase 4 — optional bulk execution */}
      {canExec && filter === "approved" && (
        <div className="ccbulk">
          <label className="hint" style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
            <input type="checkbox" checked={bulkEnabled} onChange={(e) => writeBulkEnabled(e.target.checked)} />
            Allow bulk execution (max {BULK_CAP} at a time; stops at the first unverified result)
          </label>
          {bulkEnabled && approved.length > 0 && (
            <div className="field" style={{ marginTop: 8, alignItems: "center" }}>
              <button className="ccexample" onClick={() => setSelected(new Set(approved.filter((p) => p.status === "approved").slice(0, BULK_CAP).map((p) => p.id)))}>Select all (up to {BULK_CAP})</button>
              <button className="ccexample" onClick={() => setSelected(new Set())}>Deselect all</button>
              <span style={{ flex: 1 }} />
              {bulkRunning ? (
                <button className="btn ghost sm" onClick={() => (bulkAbort.current.aborted = true)}>Abort</button>
              ) : (
                <button className="btn sm" disabled={selectedList.length === 0 || !hasToken} onClick={() => { setBulkAck(false); setBulkConfirm(true); }}>
                  Execute {selectedList.length} selected…
                </button>
              )}
            </div>
          )}
          {bulkConfirm && (
            <div style={{ marginTop: 8 }}>
              <BulkConfirm
                title={`Send ${selectedList.length} approved change${selectedList.length === 1 ? "" : "s"} to Sleeper`}
                lines={selectedList.map((p) => (
                  <span key={p.id}>
                    <strong>{p.leagueName}</strong> — {describeProposal(p)}
                  </span>
                ))}
                confirmLabel={`Send ${selectedList.length} to Sleeper, one at a time`}
                onConfirm={() => { if (bulkAck) void startBulk(selectedList); }}
                onCancel={() => setBulkConfirm(false)}
              />
              <label className="hint" style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0 0" }}>
                <input type="checkbox" checked={bulkAck} onChange={(e) => setBulkAck(e.target.checked)} />
                I&rsquo;ve reviewed every line above. (The button only works once this is ticked.)
              </label>
            </div>
          )}
          {bulkSummary && <p className="cctext">{bulkSummary}</p>}
        </div>
      )}

      {/* Phase 5 — trusted auto rules */}
      {canAutoExecute(permission) && (
        <div className="ccauto">
          <p className="cctext" style={{ margin: 0 }}><strong>Trusted auto rule</strong></p>
          <label className="hint" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "6px 0" }}>
            <input type="checkbox" checked={auto.irMove} onChange={(e) => writeAutoConfig({ ...auto, irMove: e.target.checked, enabled: e.target.checked ? auto.enabled : false })} />
            <span>Move a player Sleeper lists as <strong>IR or PUP</strong> into an <strong>open IR slot</strong>, only where that league&rsquo;s own rules allow it. Never Out/Doubtful/Questionable, never needs a drop, never touches lineups or waivers.</span>
          </label>
          <div className="field" style={{ alignItems: "center", gap: 10 }}>
            <label className="hint" style={{ margin: 0 }}>Max per run <input className="input" type="number" min={1} max={25} value={auto.maxPerRun} onChange={(e) => writeAutoConfig({ ...auto, maxPerRun: Number(e.target.value) || 1 })} style={{ width: 64 }} /></label>
            <label className="hint" style={{ margin: 0 }}>Max per day <input className="input" type="number" min={1} max={100} value={auto.maxPerDay} onChange={(e) => writeAutoConfig({ ...auto, maxPerDay: Number(e.target.value) || 1 })} style={{ width: 64 }} /></label>
            <label className="hint" style={{ margin: 0 }}>Every (min) <input className="input" type="number" min={5} max={240} value={auto.intervalMin} onChange={(e) => writeAutoConfig({ ...auto, intervalMin: Number(e.target.value) || 15 })} style={{ width: 64 }} /></label>
          </div>
          <div className="field" style={{ marginTop: 8, alignItems: "center" }}>
            <button className="ccexample" disabled={!auto.irMove || autoRunning || !pmap} onClick={() => { writeAutoConfig({ ...auto, enabled: true }); setDry(null); void autoCycle(true); }}>Preview what it would do</button>
            {!auto.enabled ? (
              <button className="btn sm" disabled={!auto.irMove || !hasToken} onClick={() => writeAutoConfig({ ...auto, enabled: true })}>Turn auto ON</button>
            ) : (
              <>
                <span className="ccstate ccv-win">Auto is ON</span>
                <button className="btn ghost sm" onClick={() => writeAutoConfig({ ...auto, enabled: false })}>Turn OFF</button>
                <button className="ccexample" disabled={autoRunning} onClick={() => void autoCycle(false)}>Run now</button>
              </>
            )}
          </div>
          <p className="hint" style={{ margin: "6px 0 0" }}>
            Runs only while this page is open in your browser (Sleeper access lives here, never on the server). Every action is verified afterwards and logged; it turns itself off at the first failure. Today: {autoDay.executed}/{auto.maxPerDay} used.
            {autoDay.lastRunAt ? ` Last run ${new Date(autoDay.lastRunAt).toLocaleTimeString()}: ${autoDay.lastMessage}` : ""}
          </p>
          {dry && (
            <div className="ccdrybox">
              <strong className="cctext">{dry.length === 0 ? "Nothing matches the rule right now." : `Would move ${dry.length}:`}</strong>
              {dry.map((d) => <div key={d} className="portmeta">{d}</div>)}
              <p className="hint" style={{ margin: "6px 0 0" }}>Preview only — nothing was sent.</p>
            </div>
          )}
        </div>
      )}

      {!proposals && !error && <p className="hint">Loading…</p>}
      {proposals && shown.length === 0 && (
        <p className="hint">
          {filter === "review" ? "Nothing waiting for review. Scan in the Chat tab, then save the proposals it drafts." : filter === "approved" ? "Nothing approved yet." : "No history yet."}
        </p>
      )}

      {shown.map((p) => {
        const isBusy = busy.has(p.id) || p.status === "executing";
        const last = p.events[p.events.length - 1];
        const ap = p.params as { faab?: boolean; bid?: number; expectWaiver?: boolean };
        const confirming = confirmId === p.id;
        const bs = bulkStatus[p.id];
        return (
          <div key={p.id} className="ccleague">
            <div className="ccrow">
              <span className={`ccstate ccstatecol ccp-${p.status.replace(/_/g, "-")}`}>{STATUS_LABEL[p.status]}</span>
              <span className="ccname">{p.leagueName}</span>
              <span className="portmeta">{KIND_LABEL[p.kind]}</span>
            </div>
            <div className="cctext ccindent" style={{ marginBottom: 2 }}>{describeProposal(p)}</div>
            {p.origin === "auto" && <div className="portmeta ccindent">Created by the trusted auto rule</div>}
            <details className="ccdetails ccindent">
              <summary>Why · history</summary>
              <ul className="ccreasons">{p.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
              {p.events.map((e, i) => (
                <div key={i} className="portmeta">{new Date(e.at).toLocaleString()} — {e.status}: {e.message}</div>
              ))}
            </details>

            {p.status === "proposed" && (
              <div className="field ccindent" style={{ alignItems: "center" }}>
                {p.kind === "ADD" && ap.faab && ap.expectWaiver && (
                  <label className="hint" style={{ margin: 0 }}>
                    FAAB bid $
                    <input className="input" type="number" min={0} defaultValue={ap.bid ?? 0} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== (ap.bid ?? 0)) void setBid(p, v); }} style={{ width: 70, marginLeft: 6 }} />
                  </label>
                )}
                <button className="btn sm" disabled={isBusy || permission === "READ_ONLY"} onClick={() => act(p, "approved", "Approved by you")}>Approve</button>
                <button className="btn ghost sm" disabled={isBusy} onClick={() => act(p, "rejected", "Rejected by you")}>Reject</button>
              </div>
            )}

            {p.status === "approved" && !confirming && (
              <div className="field ccindent" style={{ alignItems: "center" }}>
                {bulkEnabled && canExec && (
                  <input type="checkbox" aria-label="Select for bulk" checked={selected.has(p.id)} disabled={bulkRunning} onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else if (n.size < BULK_CAP) n.add(p.id); return n; })} />
                )}
                <button className="btn sm" disabled={isBusy || !canExec || !hasToken} onClick={() => { setAck(false); setConfirmId(p.id); }}>Execute…</button>
                <button className="btn ghost sm" disabled={isBusy} onClick={() => act(p, "proposed", "Approval withdrawn by you")}>Unapprove</button>
                <button className="btn ghost sm" disabled={isBusy} onClick={() => act(p, "rejected", "Rejected by you")}>Reject</button>
                {!canExec && <span className="portmeta" style={{ color: "var(--amber)" }}>Switch to Execute approved to send this.</span>}
                {canExec && !hasToken && <span className="portmeta" style={{ color: "var(--red)" }}>Connect Sleeper access to send this.</span>}
              </div>
            )}

            {p.status === "approved" && confirming && (
              <div className="ccconfirmbox ccindent">
                <p className="cctext" style={{ margin: 0 }}><strong>Send this to Sleeper now?</strong></p>
                <p className="hint" style={{ margin: "6px 0" }}>
                  {p.leagueName}: {describeProposal(p)}. It will be re-checked against live data first (and cancelled if anything changed), sent once, then verified. It can&rsquo;t be undone from here.
                </p>
                <label className="hint" style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 8px" }}>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  I&rsquo;ve reviewed this change and want it sent.
                </label>
                <div className="field">
                  <button className="btn" disabled={!ack || isBusy} onClick={() => void runOne(p)}>Yes, send to Sleeper</button>
                  <button className="btn ghost" onClick={() => setConfirmId(null)}>Go back</button>
                </div>
              </div>
            )}

            {p.status === "executing" && !busy.has(p.id) && tick - p.updatedAt > 120_000 && (
              <div className="field ccindent" style={{ alignItems: "center" }}>
                <span className="portmeta" style={{ color: "var(--amber)" }}>This has been running for a while — the page may have closed mid-run. Check Sleeper before doing anything else.</span>
                <button className="btn ghost sm" onClick={() => act(p, "verify_failed", "Marked unverified by you: the run didn't finish (page closed?). Check Sleeper.")}>Mark as unverified</button>
              </div>
            )}
            {isBusy && <div className="portmeta ccindent">Working…</div>}
            {bs && bs.kind === "failed" && <div className="err ccindent">{bs.message}</div>}
            {notes[p.id] ? (
              <div className={`portmeta ccindent ${p.status === "executed" || p.status === "submitted" ? "" : "ccnote-warn"}`}>{notes[p.id]}</div>
            ) : (
              !["proposed", "approved"].includes(p.status) && last && <div className="portmeta ccindent">{last.message}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
