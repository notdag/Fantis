"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cancelWaiverClaim, claimWaiver, fetchLeagueTransactions } from "@/lib/sleeperWrite";
import { classifyTransactions, type Claim } from "@/lib/inbox";
import { runBulk, errorMessage, type BulkTask } from "@/lib/bulkRun";
import { posChipStyle } from "@/lib/players";
import type { PlayerMap } from "@/lib/types";
import type { LineupLeague } from "./LineupManager";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";

const inner = (settings: unknown, key: string): number => {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>).settings : null;
  const v = s && typeof s === "object" ? (s as Record<string, unknown>)[key] : null;
  return typeof v === "number" ? v : 0;
};

// Your pending waiver claims across every league, read from Sleeper (needs write access — the same private feed the Inbox uses).
// Change a FAAB bid or cancel a claim. Sleeper has no "edit bid" call, so changing a bid = cancel the claim, then place the same
// add/drop again with the new bid (it re-enters the queue at the end of your claims in that league — said so on the row).
export default function PendingClaims({
  leagues,
  pmap,
  token,
  reloadSignal,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  reloadSignal: number;
}) {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [bids, setBids] = useState<Record<string, number>>({});
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const loadedOnce = useRef(false);
  const byId = new Map(leagues.map((l) => [l.league.id, l]));
  const nameOf = (id: string | null) => (id ? pmap?.[id]?.n ?? id : "—");

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setErrors([]);
    const acc: Claim[] = [];
    const errs: string[] = [];
    const tasks: BulkTask[] = leagues
      .filter((l) => l.roster)
      .map((l) => ({
        key: l.league.id,
        run: async () => {
          const raw = await fetchLeagueTransactions(token, { leagueId: l.league.id, rosterId: l.roster!.rosterId });
          acc.push(...classifyTransactions(l.league.id, l.roster!.rosterId, raw).claims);
        },
      }));
    const res = await runBulk(tasks, {
      concurrency: 5,
      gapMs: 50,
      signal: { aborted: false },
      onStatus: (key, s) => {
        if (s.kind === "failed" && errs.length < 10) errs.push(`${byId.get(key)?.league.name ?? key}: ${s.message}`);
      },
    });
    if (res.stoppedForAuth) errs.unshift("Sleeper rejected the login token — reconnect above.");
    acc.sort((a, b) => (byId.get(a.leagueId)?.league.name ?? "").localeCompare(byId.get(b.leagueId)?.league.name ?? "") || (a.created ?? 0) - (b.created ?? 0));
    setClaims(acc);
    setErrors(errs);
    setLoading(false);
    loadedOnce.current = true;
  };

  // After new claims are sent from this page, re-read so they show up here (only if the list was already loaded).
  useEffect(() => {
    if (reloadSignal > 0 && loadedOnce.current) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  const setBusyKey = (k: string, on: boolean) =>
    setBusy((p) => {
      const n = new Set(p);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });

  const cancel = async (c: Claim) => {
    if (!token) return;
    setBusyKey(c.key, true);
    try {
      await cancelWaiverClaim(token, { leagueId: c.leagueId, transactionId: c.transactionId, leg: c.leg });
      setClaims((cs) => (cs ?? []).filter((x) => x.key !== c.key));
    } catch (e) {
      setRowMsg((m) => ({ ...m, [c.key]: { ok: false, text: `Cancel failed: ${errorMessage(e)}` } }));
    } finally {
      setBusyKey(c.key, false);
    }
  };

  const saveBid = async (c: Claim) => {
    if (!token || !c.addId) return;
    const l = byId.get(c.leagueId);
    if (!l?.roster) return;
    const bid = bids[c.key];
    setBusyKey(c.key, true);
    try {
      await cancelWaiverClaim(token, { leagueId: c.leagueId, transactionId: c.transactionId, leg: c.leg });
    } catch (e) {
      setRowMsg((m) => ({ ...m, [c.key]: { ok: false, text: `Couldn't change the bid — cancelling the old claim failed: ${errorMessage(e)}. Nothing changed.` } }));
      setBusyKey(c.key, false);
      return;
    }
    try {
      await claimWaiver(token, { leagueId: c.leagueId, rosterId: l.roster.rosterId, addPlayerId: c.addId, dropPlayerId: c.dropId ?? undefined, bid });
      setRowMsg((m) => ({ ...m, [c.key]: { ok: true, text: `✓ Re-placed at $${bid}` } }));
      void load();
    } catch (e) {
      setRowMsg((m) => ({
        ...m,
        [c.key]: { ok: false, text: `The old claim was cancelled, but placing it again at $${bid} failed: ${errorMessage(e)}. Re-add ${nameOf(c.addId)} above.` },
      }));
    } finally {
      setBusyKey(c.key, false);
    }
  };

  return (
    <>
      <div className="field" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button className="btn ghost sm" disabled={!token || loading} onClick={load}>
          {loading ? "Reading claims…" : claims ? "Refresh my claims" : "Show my pending claims"}
        </button>
        {!token && <span className="hint" style={{ margin: 0 }}>Connect write access above to read your claims.</span>}
        {claims && <span className="portmeta">{claims.length} pending across {new Set(claims.map((c) => c.leagueId)).size} leagues</span>}
      </div>
      <p className="hint" style={{ margin: "6px 0 10px" }}>
        Changing a bid cancels the claim and places it again with the new bid (Sleeper has no &ldquo;edit&rdquo;), so it moves to the end of your claim order
        in that league.
      </p>
      {errors.length > 0 && <p className="hint" style={{ color: "var(--amber)" }}>⚠ {errors.join(" · ")}</p>}
      {claims && claims.length === 0 && <p className="hint">No pending claims right now.</p>}
      {claims && claims.length > 0 && (
        <div className="mgrtable-scroll">
          <DataTable>
            <TableHeaderRow>
              <span style={{ flex: "0 0 200px" }}>League</span>
              <span style={{ flex: 1 }}>Claim</span>
              <span style={{ minWidth: 120 }}>Bid</span>
              <span style={{ minWidth: 200 }} />
            </TableHeaderRow>
            {claims.map((c) => {
              const l = byId.get(c.leagueId);
              const faab = l ? inner(l.league.settings, "waiver_type") === 2 : false;
              const cur = c.key in bids ? bids[c.key] : c.bid ?? 0;
              const changed = faab && c.key in bids && bids[c.key] !== (c.bid ?? 0);
              const left = l && faab ? Math.max(0, inner(l.league.settings, "waiver_budget") - (l.roster?.faabUsed ?? 0)) : null;
              const msg = rowMsg[c.key];
              return (
                <TableRow key={c.key}>
                  <span style={{ flex: "0 0 200px", minWidth: 0 }}>
                    <Link href={`/manager/${c.leagueId}`} className="tname">{l?.league.name ?? c.leagueId}</Link>
                    <span className="portmeta" style={{ display: "block" }}>{c.status}</span>
                  </span>
                  <span style={{ flex: 1 }}>
                    + {nameOf(c.addId)}
                    {c.addId && pmap?.[c.addId]?.p && <span className="pos" style={{ ...posChipStyle(pmap[c.addId].p), marginLeft: 6 }}>{pmap[c.addId].p}</span>}
                    {c.dropId && <span className="portmeta"> · drop {nameOf(c.dropId)}</span>}
                    {msg && <span className="portmeta" style={{ display: "block", color: msg.ok ? "var(--mint)" : "var(--red)" }}>{msg.text}</span>}
                  </span>
                  <span style={{ minWidth: 120 }}>
                    {faab ? (
                      <label className="portmeta" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        $
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={left ?? undefined}
                          value={cur}
                          disabled={busy.has(c.key)}
                          onChange={(e) => setBids((b) => ({ ...b, [c.key]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) }))}
                          style={{ width: 64 }}
                        />
                        {left != null && <span style={{ fontSize: 11 }}>${left} left</span>}
                      </label>
                    ) : (
                      <span className="portmeta">no FAAB</span>
                    )}
                  </span>
                  <span style={{ minWidth: 200, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    {changed && (
                      <button className="btn sm" disabled={!token || busy.has(c.key)} onClick={() => saveBid(c)}>
                        Save ${bids[c.key]}
                      </button>
                    )}
                    <button className="btn ghost sm" disabled={!token || busy.has(c.key)} onClick={() => cancel(c)}>
                      {busy.has(c.key) ? "Working…" : "Cancel claim"}
                    </button>
                  </span>
                </TableRow>
              );
            })}
          </DataTable>
        </div>
      )}
    </>
  );
}
