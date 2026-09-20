"use client";

import { useMemo, useRef, useState } from "react";
import { buildIrPlan, type IrRow, type PlanLeague } from "@/lib/bulkPlan";
import { runBulk, errorMessage, type BulkTask, type TaskStatus } from "@/lib/bulkRun";
import { addDropFreeAgent, moveToIR, setStarters } from "@/lib/sleeperWrite";
import { posChipStyle } from "@/lib/players";
import type { PlayerMap } from "@/lib/types";
import type { LineupLeague } from "./LineupManager";
import { PlayerAvatar } from "./Avatar";
import { Badge } from "./Badge";
import { StatCard, StatCardGrid } from "./StatCard";
import { DataTable, TableRow, TableHeaderRow } from "./DataRow";
import { BulkConfirm, StatusCell } from "./BulkConfirm";
import { useDropRank } from "./useDropRank";

const INJ_TONE = {
  color: "var(--red)",
  background: "color-mix(in srgb, var(--red) 20%, transparent)",
  borderColor: "color-mix(in srgb, var(--red) 52%, transparent)",
};

function nameOf(pmap: PlayerMap | null, id: string | null): string {
  if (!id) return "—";
  return pmap?.[id]?.n ?? id;
}

export default function BulkIR({
  leagues,
  pmap,
  token,
  currentWeek,
}: {
  leagues: LineupLeague[];
  pmap: PlayerMap | null;
  token: string | null;
  currentWeek: number;
}) {
  const rank = useDropRank(pmap);

  const planLeagues = useMemo<PlanLeague[]>(
    () =>
      leagues
        .filter((l) => l.roster)
        .map((l) => ({
          leagueId: l.league.id,
          leagueName: l.league.name,
          rosterId: l.roster!.rosterId,
          settings: l.league.settings,
          starters: l.roster!.starters,
          players: l.roster!.players,
          reserve: l.roster!.reserve,
          faabUsed: l.roster!.faabUsed,
        })),
    [leagues]
  );

  const rows = useMemo(
    () => buildIrPlan(planLeagues, (id) => pmap?.[id]?.inj ?? null, rank),
    [planLeagues, pmap, rank]
  );

  // Everything is selected by default; the user un-checks. (Stored as the
  // deselected set so the default needs no effect/initialisation once the
  // async player map loads.)
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [dropOverride, setDropOverride] = useState<Record<string, string | null>>({});
  const [status, setStatus] = useState<Record<string, TaskStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState("");
  const abortRef = useRef({ aborted: false });

  const dropFor = (r: IrRow) => (r.key in dropOverride ? dropOverride[r.key] : r.dropId);
  const finished = (r: IrRow) => status[r.key]?.kind === "done";
  const runnable = (r: IrRow) => !finished(r) && !r.noRoom && (!r.needsDrop || !!dropFor(r));
  const selectedRows = rows.filter((r) => !deselected.has(r.key) && runnable(r));
  const leaguesAffected = new Set(rows.map((r) => r.leagueId)).size;
  const dropCount = selectedRows.filter((r) => r.needsDrop).length;

  // One-click case: players Sleeper lists as "IR" that fit in an open IR slot.
  // Leagues whose IR is already full are never touched by this — they're
  // reported instead, so nothing gets dropped without you choosing it.
  const openRows = rows.filter((r) => !finished(r));
  const irQuick = openRows.filter((r) => !r.needsDrop); // every eligible player that fits
  const irStatusQuick = irQuick.filter((r) => r.injury === "IR"); // just Sleeper's literal "IR" status
  const irBlocked = openRows.filter((r) => r.needsDrop); // IR full in that league
  const blockedLeagues = new Set(irBlocked.map((r) => r.leagueId)).size;
  const moveOnly = (keepRows: IrRow[]) => {
    const keep = new Set(keepRows.map((r) => r.key));
    setDeselected(new Set(rows.filter((r) => !keep.has(r.key)).map((r) => r.key)));
    setConfirming(true);
  };

  const toggle = (key: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const start = async () => {
    if (!token) return;
    setConfirming(false);
    setRunning(true);
    setSummary("");
    abortRef.current = { aborted: false };

    const tasks: BulkTask[] = selectedRows.map((r) => ({
      key: r.key,
      run: async () => {
        const drop = r.needsDrop ? dropFor(r) : null;
        if (drop) {
          await addDropFreeAgent(token, { leagueId: r.leagueId, rosterId: r.rosterId, dropPlayerId: drop });
        }
        try {
          await moveToIR(token, { leagueId: r.leagueId, rosterId: r.rosterId, playerId: r.playerId });
          return drop ? `dropped ${nameOf(pmap, drop)}` : undefined;
        } catch (e) {
          // A starter has to leave the lineup before Sleeper will IR him —
          // vacate that one slot and try once more.
          const lg = planLeagues.find((l) => l.leagueId === r.leagueId);
          if (r.inStarters && lg) {
            try {
              await setStarters(token, {
                leagueId: r.leagueId,
                rosterId: r.rosterId,
                starters: lg.starters.map((id) => (id === r.playerId ? "0" : id)),
                week: currentWeek,
              });
              await moveToIR(token, { leagueId: r.leagueId, rosterId: r.rosterId, playerId: r.playerId });
              return "cleared his lineup slot first";
            } catch (e2) {
              throw new Error(`${drop ? `Dropped ${nameOf(pmap, drop)}, but ` : ""}IR move failed: ${errorMessage(e2)}`);
            }
          }
          throw new Error(`${drop ? `Dropped ${nameOf(pmap, drop)}, but ` : ""}IR move failed: ${errorMessage(e)}`);
        }
      },
    }));

    const result = await runBulk(tasks, {
      signal: abortRef.current,
      onStatus: (key, s) => setStatus((prev) => ({ ...prev, [key]: s })),
    });
    setRunning(false);
    setSummary(
      `${result.done} moved${result.failed ? `, ${result.failed} failed` : ""}${
        result.skipped ? `, ${result.skipped} skipped` : ""
      }.${result.stoppedForAuth ? " Stopped early — Sleeper rejected the login token; reconnect above." : ""}` +
        (result.done ? " Run Sync now on the Command Center to refresh Fantis's own data before another pass." : "")
    );
  };

  if (!pmap) return <p className="hint">Loading players…</p>;

  return (
    <>
      <StatCardGrid variant="grid">
        <StatCard label="Leagues affected" value={leaguesAffected} />
        <StatCard label="Players to move" value={rows.length} />
        <StatCard
          label="Need a drop first"
          value={rows.filter((r) => r.needsDrop).length}
          valueColor={rows.some((r) => r.needsDrop) ? "var(--amber)" : undefined}
        />
      </StatCardGrid>
      <p className="hint" style={{ margin: "8px 0 12px" }}>
        Out, IR, NA and other ruled-out players your league&rsquo;s own IR rules allow, one row each
        (Doubtful players are never included). When a league&rsquo;s
        IR is full, Fantis proposes dropping the lowest-value player currently on IR (dropping a
        bench player wouldn&rsquo;t free an IR slot) — change any pick, or uncheck the row.
      </p>

      {rows.length === 0 ? (
        <p className="hint">No injured players eligible for IR in any league right now.</p>
      ) : (
        <>
          <div className="field" style={{ marginBottom: 12, alignItems: "center" }}>
            <button className="chip-filter" onClick={() => setDeselected(new Set())}>Select all</button>
            <button className="chip-filter" onClick={() => setDeselected(new Set(rows.map((r) => r.key)))}>Select none</button>
            <span style={{ flex: 1 }} />
            {!running && (
              <>
                <button className="btn ghost" disabled={!token || irStatusQuick.length === 0 || confirming} onClick={() => moveOnly(irStatusQuick)}>
                  IR-status only ({irStatusQuick.length})
                </button>
                <button className="btn" disabled={!token || irQuick.length === 0 || confirming} onClick={() => moveOnly(irQuick)}>
                  Move all eligible to IR ({irQuick.length})
                </button>
              </>
            )}
            {running ? (
              <button className="btn ghost" onClick={() => (abortRef.current.aborted = true)}>Abort</button>
            ) : (
              <button
                className="btn"
                disabled={!token || selectedRows.length === 0 || confirming}
                onClick={() => setConfirming(true)}
              >
                Move {selectedRows.length} to IR
              </button>
            )}
          </div>
          {!token && <p className="hint" style={{ color: "var(--red)" }}>Connect write access above first.</p>}

          {confirming && (
            <BulkConfirm
              title={`Move ${selectedRows.length} players to IR across ${new Set(selectedRows.map((r) => r.leagueId)).size} leagues${
                dropCount ? ` — including ${dropCount} drop${dropCount === 1 ? "" : "s"}` : ""
              }`}
              lines={selectedRows.map((r) => (
                <span key={r.key}>
                  {r.leagueName}: {nameOf(pmap, r.playerId)} → IR
                  {r.needsDrop && <strong> · drop {nameOf(pmap, dropFor(r))}</strong>}
                </span>
              ))}
              confirmLabel={`Send ${selectedRows.length} changes to Sleeper`}
              onConfirm={start}
              onCancel={() => setConfirming(false)}
            />
          )}
          {irBlocked.length > 0 && (
            <div className="card sync" style={{ marginBottom: 12, borderColor: "var(--amber)" }}>
              <p className="hint" style={{ margin: 0, color: "var(--amber)", fontWeight: 600 }}>
                {blockedLeagues} league{blockedLeagues === 1 ? "" : "s"} already ha{blockedLeagues === 1 ? "s" : "ve"} IR full
              </p>
              <p className="hint" style={{ margin: "6px 0 0" }}>
                {irBlocked.length} eligible player{irBlocked.length === 1 ? "" : "s"} can&rsquo;t go to IR without
                dropping someone, so the quick buttons skip them:{" "}
                {irBlocked.slice(0, 6).map((r) => `${nameOf(pmap, r.playerId)} (${r.leagueName})`).join("; ")}
                {irBlocked.length > 6 ? ` and ${irBlocked.length - 6} more` : ""}. To include one, pick who to drop
                in its row below and check it.
              </p>
            </div>
          )}
          {summary && <p className="hint" style={{ color: "var(--bone)" }}>{summary}</p>}

          <div style={{ maxHeight: 640, overflowY: "auto" }}>
            <DataTable>
              <TableHeaderRow>
                <span style={{ width: 22 }} />
                <span style={{ flex: 1 }}>League · player</span>
                <span style={{ minWidth: 200 }}>Action</span>
                <span style={{ minWidth: 90 }}>Result</span>
              </TableHeaderRow>
              {rows.map((r) => {
                const entry = pmap[r.playerId];
                return (
                  <TableRow key={r.key} style={finished(r) ? { opacity: 0.6 } : undefined}>
                    <input
                      type="checkbox"
                      checked={!deselected.has(r.key) && runnable(r)}
                      disabled={!runnable(r) || running}
                      onChange={() => toggle(r.key)}
                    />
                    <PlayerAvatar playerId={r.playerId} pos={entry?.p} size={24} />
                    <span className="tname" style={{ flex: 1 }}>
                      {entry?.n ?? r.playerId}
                      {entry?.p && <span className="pos" style={{ ...posChipStyle(entry.p), marginLeft: 6 }}>{entry.p}</span>}
                      <span className="portmeta" style={{ display: "block", fontWeight: 400 }}>{r.leagueName}</span>
                    </span>
                    <Badge tone={INJ_TONE}>{r.injury}</Badge>
                    <span style={{ minWidth: 200 }}>
                      {r.noRoom ? (
                        <span className="portmeta" style={{ color: "var(--red)" }}>IR full, nobody to drop</span>
                      ) : r.needsDrop ? (
                        <select
                          className="select sm"
                          value={dropFor(r) ?? ""}
                          disabled={running || finished(r)}
                          onChange={(e) => setDropOverride((p) => ({ ...p, [r.key]: e.target.value || null }))}
                        >
                          <option value="">— pick who to drop —</option>
                          {r.dropCandidates.map((id) => (
                            <option key={id} value={id}>drop {nameOf(pmap, id)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="portmeta">→ IR{r.inStarters ? " (in lineup)" : ""}</span>
                      )}
                    </span>
                    <StatusCell status={status[r.key]} />
                  </TableRow>
                );
              })}
            </DataTable>
          </div>
        </>
      )}
    </>
  );
}
