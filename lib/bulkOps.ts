// Command Center 2.0 — the shared bulk-operation framework every manager tool sends through.
//
//   1. targets      → one BulkOp per concrete change (league + action), each with a stable `opKey`
//   2. planBulkOps  → eligibility, duplicate and conflict detection (pure, tested)
//   3. review       → the tool shows proposed + excluded ops; the person explicitly confirms
//   4. runBulkOps   → per-op: skip if this exact change was already sent recently (survives reloads, via the activity log),
//                     run once (never auto-retried), classify the outcome honestly (ok / failed / uncertain), log it
//   5. verify       → optional re-read; a change that can't be confirmed is "unverified", never reported as done
//
// Nothing here talks to Sleeper itself: the tool passes `run` / `verify` closures built from lib/sleeperWrite.ts.
import { runBulk, errorMessage, isAuthError, type TaskStatus } from "./bulkRun";

export type OpStatus = "ok" | "failed" | "skipped" | "uncertain" | "unverified" | "submitted" | "started";

export interface BulkOp {
  opKey: string; // stable identity of ONE concrete change, e.g. "mass_add:123:add:456:drop:789"
  tool: string;
  leagueId: string;
  leagueName: string;
  playerId?: string;
  playerName?: string;
  action: string; // human description: "add X, drop Y"
  // Resources this op consumes in its league — two ops in one league that both claim the same resource conflict
  // (e.g. both drop the same player, or both add the same player).
  uses?: string[];
  excluded?: string; // set by the tool when ineligible (reason shown in review)
  statusKey?: string; // the tool's own row key for on-screen status (defaults to opKey)
  exec?: () => Promise<string | void>; // per-op sender (instead of opts.run)
  check?: () => Promise<boolean | null>; // per-op re-read verification (instead of opts.verify)
}

export interface PlannedOps<T extends BulkOp> {
  run: T[];
  excluded: { op: T; reason: string }[];
}

// Eligibility, exact duplicates (same opKey) and per-league resource conflicts. First occurrence wins; later ones are
// excluded with a reason — never silently dropped.
export function planBulkOps<T extends BulkOp>(ops: T[]): PlannedOps<T> {
  const run: T[] = [];
  const excluded: { op: T; reason: string }[] = [];
  const seenKeys = new Set<string>();
  const used = new Map<string, string>(); // "league|resource" -> action that claimed it
  for (const op of ops) {
    if (op.excluded) {
      excluded.push({ op, reason: op.excluded });
      continue;
    }
    if (seenKeys.has(op.opKey)) {
      excluded.push({ op, reason: "duplicate — the same change is already in this batch" });
      continue;
    }
    const clash = (op.uses ?? []).map((r) => `${op.leagueId}|${r}`).find((k) => used.has(k));
    if (clash) {
      excluded.push({ op, reason: `conflicts with "${used.get(clash)}" in the same league` });
      continue;
    }
    seenKeys.add(op.opKey);
    for (const r of op.uses ?? []) used.set(`${op.leagueId}|${r}`, op.action);
    run.push(op);
  }
  return { run, excluded };
}

// A failed request isn't always a failed change: a timeout or dropped connection can happen AFTER Sleeper applied it.
// Those are "uncertain" — shown for a manual check and never retried automatically.
export function classifyError(e: unknown): "failed" | "uncertain" {
  const m = errorMessage(e).toLowerCase();
  if (/timeout|timed out|network|failed to fetch|fetch failed|aborted|econnreset|socket|502|503|504/.test(m)) return "uncertain";
  return "failed";
}

export interface LogEntry {
  kind: string;
  tool: string;
  status: OpStatus;
  leagueId?: string | null;
  leagueName?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  action: string;
  message?: string | null;
  batchId?: string | null;
  opKey?: string | null;
}

const KINDS = new Set(["scan", "plan", "approve", "reject", "execute", "verify", "skip", "conflict"]);
const STATUSES = new Set(["ok", "failed", "skipped", "uncertain", "unverified", "submitted", "started"]);
const s = (v: unknown, n: number) => (typeof v === "string" && v.length ? v.slice(0, n) : null);

// Server-side input check for the activity API (untrusted body → a row, or null).
export function sanitizeLogEntry(x: unknown): (LogEntry & { action: string }) | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const kind = s(o.kind, 20);
  const tool = s(o.tool, 30);
  const status = s(o.status, 20);
  const action = s(o.action, 300);
  if (!kind || !KINDS.has(kind) || !tool || !status || !STATUSES.has(status) || !action) return null;
  return {
    kind,
    tool,
    status: status as OpStatus,
    action,
    leagueId: s(o.leagueId, 40),
    leagueName: s(o.leagueName, 120),
    playerId: s(o.playerId, 40),
    playerName: s(o.playerName, 80),
    message: s(o.message, 500),
    batchId: s(o.batchId, 60),
    opKey: s(o.opKey, 200),
  };
}

// ---- client helpers (browser only) ----

export async function logActivity(entries: LogEntry[]): Promise<boolean> {
  if (entries.length === 0) return true;
  try {
    for (let i = 0; i < entries.length; i += 500) {
      const res = await fetch("/api/manager/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: entries.slice(i, i + 500) }),
      });
      if (!res.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Which of these exact changes were already sent (or may have been) in the last `withinMin` minutes — e.g. before a reload.
export async function recentlySent(keys: string[], withinMin = 30): Promise<Set<string> | null> {
  if (keys.length === 0) return new Set();
  try {
    const out = new Set<string>();
    for (let i = 0; i < keys.length; i += 200) {
      const q = encodeURIComponent(keys.slice(i, i + 200).join(","));
      const res = await fetch(`/api/manager/activity?recentKeys=${q}&withinMin=${withinMin}`);
      if (!res.ok) return null;
      const b = (await res.json()) as { sent?: string[] };
      for (const k of b.sent ?? []) out.add(k);
    }
    return out;
  } catch {
    return null; // couldn't check — the caller decides (we warn, and still require the person's confirm)
  }
}

export const newBatchId = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export interface RunOpsResult {
  done: number;
  failed: number;
  skipped: number;
  uncertain: number;
  unverified: number;
  stoppedForAuth: boolean;
  dedupChecked: boolean;
}

// Runs the planned ops through the existing bulk runner with the safety rules above, logging every outcome.
// `run` returns an optional note; returning "submitted" (e.g. a waiver claim) records that status instead of ok.
export async function runBulkOps<T extends BulkOp>(
  ops: T[],
  opts: {
    run?: (op: T) => Promise<string | void>;
    verify?: (op: T) => Promise<boolean | null>; // true confirmed · false not as expected · null couldn't check
    onStatus: (opKey: string, status: TaskStatus) => void;
    signal: { aborted: boolean };
    concurrency?: number;
    batchId?: string;
  }
): Promise<RunOpsResult> {
  const batchId = opts.batchId ?? newBatchId();
  const sentBefore = await recentlySent(ops.map((o) => o.opKey));
  const log: LogEntry[] = [];
  const base = (op: T) => ({ tool: op.tool, leagueId: op.leagueId, leagueName: op.leagueName, playerId: op.playerId ?? null, playerName: op.playerName ?? null, action: op.action, batchId, opKey: op.opKey });
  let uncertain = 0;
  let unverified = 0;
  let skippedDup = 0;
  const byKey = new Map(ops.map((o) => [o.opKey, o]));
  const res = await runBulk(
    ops.map((op) => ({
      key: op.opKey,
      run: async () => {
        if (sentBefore?.has(op.opKey)) {
          skippedDup++;
          log.push({ ...base(op), kind: "skip", status: "skipped", message: "already sent in the last 30 min (duplicate guard)" });
          throw new Error("Already sent in the last 30 minutes — not sent again. Check Sleeper; re-run later if it really didn't go through.");
        }
        let note: string | void;
        try {
          if (op.exec) note = await op.exec();
          else if (opts.run) note = await opts.run(op);
          else throw new Error("nothing to run");
        } catch (e) {
          const kind = isAuthError(e) ? "failed" : classifyError(e);
          if (kind === "uncertain") {
            uncertain++;
            log.push({ ...base(op), kind: "execute", status: "uncertain", message: errorMessage(e) });
            throw new Error(`Outcome unknown (${errorMessage(e)}) — it may have gone through. Check Sleeper before trying again; not retried.`);
          }
          log.push({ ...base(op), kind: "execute", status: "failed", message: errorMessage(e) });
          throw e;
        }
        const submitted = typeof note === "string" && /claim/i.test(note);
        const verifier = op.check ?? (opts.verify ? () => opts.verify!(op) : undefined);
        if (verifier && !submitted) {
          let v: boolean | null = null;
          try {
            v = await verifier();
          } catch {
            v = null;
          }
          if (v !== true) {
            unverified++;
            log.push({ ...base(op), kind: "execute", status: "unverified", message: v === false ? "sent, but a re-read doesn't show it" : "sent, couldn't re-read to confirm" });
            return `${note || "sent"} — not confirmed by a re-read, check Sleeper`;
          }
        }
        log.push({ ...base(op), kind: "execute", status: submitted ? "submitted" : "ok", message: note || null });
        return note || undefined;
      },
    })),
    {
      signal: opts.signal,
      concurrency: opts.concurrency,
      onStatus: (key, st) => {
        if (st.kind === "skipped") {
          const op = byKey.get(key);
          if (op) log.push({ ...base(op), kind: "skip", status: "skipped", message: st.reason });
        }
        opts.onStatus(byKey.get(key)?.statusKey ?? key, st);
      },
    }
  );
  await logActivity(log);
  return {
    done: res.done,
    failed: res.failed - uncertain - skippedDup,
    skipped: res.skipped + skippedDup,
    uncertain,
    unverified,
    stoppedForAuth: res.stoppedForAuth,
    dedupChecked: sentBefore !== null,
  };
}

// Extra words for a tool's completion line, so an uncertain / unconfirmed / duplicate-skipped change is never hidden
// inside a "done" count.
export function opsSummaryExtra(r: RunOpsResult): string {
  const bits: string[] = [];
  if (r.uncertain) bits.push(`${r.uncertain} outcome${r.uncertain === 1 ? "" : "s"} unknown (timeout — check Sleeper, not retried)`);
  if (r.unverified) bits.push(`${r.unverified} sent but not confirmed by a re-read (check Sleeper)`);
  if (!r.dedupChecked) bits.push("couldn't check the activity log for recent duplicates");
  return bits.length ? ` ⚠ ${bits.join(" · ")}.` : "";
}
