"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRosters, getState, getTransactions } from "@/lib/sleeper";
import { getWeekGameStates } from "@/lib/espnGames";
import { activateFromIR, addDropFreeAgent, claimWaiver, fetchLeagueTransactions, moveToIR, setStarters, SleeperGraphQLError } from "@/lib/sleeperWrite";
import { getStoredToken } from "@/lib/sleeperToken";
import { isAuthError, runBulk, bulkResultTone, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { usePlayerMap } from "@/lib/usePlayerMap";
import { fetchSnapshot, type RawRoster, type RawTxn } from "@/lib/commandCenter/classify";
import { KIND_LABEL, canSend, describeProposal, type Proposal, type ProposalStatus } from "@/lib/commandCenter/proposals";
import type { CcLeague } from "@/lib/commandCenter/types";
import { executeProposal, type ExecDeps, type ExecMode, type ExecResult, type ExecWriters } from "@/lib/commandCenterExec";
import { useRefreshLeagues } from "./useRefreshLeagues";
import { readPermission, useBulkEnabled, usePermission, writeBulkEnabled } from "./ccStore";

const BULK_CAP = 200;

const STATUS_LABEL: Record<ProposalStatus, string> = {
  proposed: "Ready to send",
  approved: "Ready to send",
  rejected: "Rejected",
  expired: "Expired",
  executing: "Sending…",
  executed: "Done · verified",
  submitted: "Claim pending",
  failed: "Failed",
  verify_failed: "Sent · unverified",
};

const WRITERS: ExecWriters = {
  addDropFreeAgent,
  claimWaiver,
  moveToIR,
  activateFromIR,
  setStarters,
  fetchLeagueTransactions: async (token, p) => {
    const r = await fetchLeagueTransactions(token, p);
    return { trades: r.trades, waivers: r.waivers as unknown as { status: string; adds?: Record<string, number> | null; roster_ids?: number[] | null }[] };
  },
};

type Filter = "review" | "history";

export default function ProposalsPanel({ leagues, version }: { leagues: CcLeague[]; version: number }) {
  const permission = usePermission();
  const bulkEnabled = useBulkEnabled();
  const { pmap } = usePlayerMap();
  const refresh = useRefreshLeagues();

  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("review");
  const [notes, setNotes] = useState<Record<string, string>>({}); // per-proposal outcome / error
  const [busy, setBusy] = useState<Set<string>>(new Set());
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
        week: week ?? leg,
        bulkEnabled,
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
      const startErr = await patch(p.id, { status: "executing", message: mode === "bulk" ? "Started in a bulk run you confirmed" : "Started by you" });
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

  // ---- bulk — its own switch, sequential, stops on the first problem.
  // Selecting the rows IS the review; clicking Send runs it immediately —
  // no separate confirm screen on top of that, by explicit owner request
  // (still always one deliberate click, never unattended).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<Record<string, TaskStatus>>({});
  const [bulkSummary, setBulkSummary] = useState("");
  const [bulkSummaryColor, setBulkSummaryColor] = useState("var(--bone)");
  const bulkAbort = useRef({ aborted: false });

  const startBulk = async (list: Proposal[]) => {
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
    const tone = bulkResultTone(result);
    setBulkSummaryColor(tone.color);
    setBulkSummary(`${tone.prefix}${result.done} succeeded${result.failed ? `, ${result.failed} failed` : ""}${result.skipped ? `, ${result.skipped} not run` : ""}.${result.stoppedForAuth ? " Stopped: Sleeper rejected the login token." : ""}`);
    await load();
  };

  // ---- derived lists
  const list = proposals ?? [];
  const live = permission === "LIVE";
  const review = list.filter((p) => p.status === "proposed" || p.status === "approved" || p.status === "executing");
  const history = list.filter((p) => !["proposed", "approved", "executing"].includes(p.status));
  const unfiltered = filter === "review" ? review : history;
  // Find a specific league or player in a real 70-200 proposal batch
  // instead of scrolling to it — searches the league name and the same
  // human description (player names included) each card already shows.
  const [listFilter, setListFilter] = useState("");
  const shown = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    if (!q) return unfiltered;
    return unfiltered.filter((p) => p.leagueName.toLowerCase().includes(q) || describeProposal(p).toLowerCase().includes(q));
  }, [unfiltered, listFilter]);
  const hasToken = typeof window !== "undefined" && !!getStoredToken();
  const sendable = review.filter((p) => p.status === "proposed" || p.status === "approved");
  const selectedList = sendable.filter((p) => selected.has(p.id));
  // A real, computed breakdown — never a guess — so a big batch (70-200
  // leagues) can be reviewed as one line instead of forcing a scroll
  // through every proposal before sending. `selectedList` is already
  // recomputed fresh each render (a plain filter, not itself memoized), so
  // this is too, rather than a useMemo that would just wrap an unstable
  // dependency.
  const selectedSummary = (() => {
    if (selectedList.length === 0) return "";
    const KIND_SUMMARY_LABEL: Record<string, string> = { ADD: "add/claim", IR_MOVE: "IR move", ACTIVATE_IR: "IR activation", SET_LINEUP: "lineup change", DROP: "release" };
    const byKind = new Map<string, number>();
    for (const p of selectedList) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
    const leagueCount = new Set(selectedList.map((p) => p.leagueId)).size;
    const parts = [...byKind.entries()].map(([kind, n]) => `${n} ${KIND_SUMMARY_LABEL[kind] ?? kind}${n === 1 ? "" : "s"}`);
    return `${parts.join(" · ")} across ${leagueCount} league${leagueCount === 1 ? "" : "s"}.`;
  })();

  return (
    <div className="ccprops">
      {error && <div className="err">{error}</div>}
      <div className="cccounts">
        {(
          [
            ["review", `To send ${review.length}`],
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

      {unfiltered.length > 8 && (
        <div className="field" style={{ margin: "0 0 10px" }}>
          <input
            className="input"
            placeholder="Find a league or player…"
            value={listFilter}
            onChange={(e) => setListFilter(e.target.value)}
            style={{ maxWidth: 240 }}
          />
          {listFilter && <span className="hint" style={{ margin: 0 }}>{shown.length} of {unfiltered.length} match</span>}
        </div>
      )}

      {!live && <p className="hint" style={{ color: "var(--amber)" }}>Planning mode: proposals below are listed but nothing can be sent. Switch to Live above to send them.</p>}
      {live && !hasToken && <p className="hint" style={{ color: "var(--red)" }}>Sleeper access isn&rsquo;t connected in this browser, so nothing can be sent. Connect it on the Lineups page.</p>}

      {/* Optional bulk execution */}
      {live && filter === "review" && sendable.length > 0 && (
        <div className="ccbulk">
          <label className="hint" style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
            <input type="checkbox" checked={bulkEnabled} onChange={(e) => writeBulkEnabled(e.target.checked)} />
            Select several and send as one reviewed batch (max {BULK_CAP} at a time; stops at the first unverified result)
          </label>
          {bulkEnabled && (
            <div className="field" style={{ marginTop: 8, alignItems: "center" }}>
              <button
                className="ccexample"
                onClick={() => setSelected(new Set(shown.filter((p) => p.status === "proposed" || p.status === "approved").slice(0, BULK_CAP).map((p) => p.id)))}
              >
                Select all{listFilter ? " shown" : ""} (up to {BULK_CAP})
              </button>
              <button className="ccexample" onClick={() => setSelected(new Set())}>Deselect all</button>
              <span style={{ flex: 1 }} />
              {bulkRunning ? (
                <button className="btn ghost sm" onClick={() => (bulkAbort.current.aborted = true)}>Abort</button>
              ) : (
                <button className="btn sm" disabled={selectedList.length === 0 || !hasToken} onClick={() => void startBulk(selectedList)}>
                  Send {selectedList.length} selected
                </button>
              )}
            </div>
          )}
          {bulkEnabled && selectedList.length > 0 && !bulkRunning && (
            <p className="hint" style={{ margin: "6px 0 0" }}>{selectedSummary}</p>
          )}
          {bulkSummary && <p className="cctext" style={{ color: bulkSummaryColor, fontWeight: 600 }}>{bulkSummary}</p>}
        </div>
      )}

      {!proposals && !error && <p className="hint">Loading…</p>}
      {proposals && shown.length === 0 && (
        <p className="hint">{filter === "review" ? "Nothing waiting to send. Scan in the Chat tab, then save the proposals it drafts." : "No history yet."}</p>
      )}

      {shown.map((p) => {
        const isBusy = busy.has(p.id) || p.status === "executing";
        const last = p.events[p.events.length - 1];
        const ap = p.params as { faab?: boolean; bid?: number; expectWaiver?: boolean };
        const bs = bulkStatus[p.id];
        const canSendThis = canSend(permission) && (p.status === "proposed" || p.status === "approved");
        return (
          <div key={p.id} className="ccleague">
            <div className="ccrow">
              <span className={`ccstate ccstatecol ccp-${p.status.replace(/_/g, "-")}`}>{STATUS_LABEL[p.status]}</span>
              <span className="ccname">{p.leagueName}</span>
              <span className="portmeta">{KIND_LABEL[p.kind]}</span>
            </div>
            <div className="cctext ccindent" style={{ marginBottom: 2 }}>{describeProposal(p)}</div>
            {p.rationale.length > 0 && (p.status === "proposed" || p.status === "approved") && (
              <ul className="ccreasons ccindent">{p.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
            )}
            {p.origin === "auto" && <div className="portmeta ccindent">Created by the (now-removed) trusted auto rule</div>}
            <details className="ccdetails ccindent">
              <summary>History</summary>
              {p.events.map((e, i) => (
                <div key={i} className="portmeta">{new Date(e.at).toLocaleString()} — {e.status}: {e.message}</div>
              ))}
            </details>

            {(p.status === "proposed" || p.status === "approved") && (
              <div className="field ccindent" style={{ alignItems: "center" }}>
                {p.kind === "ADD" && ap.faab && ap.expectWaiver && (
                  <label className="hint" style={{ margin: 0 }}>
                    FAAB bid $
                    <input className="input" type="number" min={0} defaultValue={ap.bid ?? 0} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== (ap.bid ?? 0)) void setBid(p, v); }} style={{ width: 70, marginLeft: 6 }} />
                  </label>
                )}
                {bulkEnabled && live && (
                  <input type="checkbox" aria-label="Select for batch send" checked={selected.has(p.id)} disabled={bulkRunning} onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else if (n.size < BULK_CAP) n.add(p.id); return n; })} />
                )}
                <button className="btn sm" disabled={isBusy || !canSendThis || !hasToken} onClick={() => void runOne(p)}>Send to Sleeper</button>
                <button className="btn ghost sm" disabled={isBusy} onClick={() => act(p, "rejected", "Rejected by you")}>Reject</button>
                {!live && <span className="portmeta" style={{ color: "var(--amber)" }}>Switch to Live to send this.</span>}
                {live && !hasToken && <span className="portmeta" style={{ color: "var(--red)" }}>Connect Sleeper access to send this.</span>}
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
